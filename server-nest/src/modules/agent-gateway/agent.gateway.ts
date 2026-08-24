/**
 * AgentGateway - 客服工作台 WebSocket 网关
 *
 * 协议约定（与前端 useAgentSocket 对接）：
 *   1. URL: http://host:3001/socket.io?role=client&userId=u_xxx[&userName=xxx]
 *           http://host:3001/socket.io?role=agent&agentId=a_xxx[&agentName=xxx]
 *      同时兼容 id=... 参数
 *   2. 客户端上行：socket.emit('message', { type: 'client.*' | 'agent.*', ... })
 *   3. 服务端下行：socket.emit('<SystemEventType>', event) — 事件名 = event.type
 *   4. 错误：socket.emit('error', { type: 'error', code, message })
 *
 * 设计要点：
 *   - 状态全部走 DB，内存只缓存"连接"和"会话运行时"（inactivity timer 等）
 *   - 客服端 / 客户端连接断开只清连接引用，会话/队列/历史由 DB 持有
 *   - 重连场景：客户端 connect 时如果发现 active session，自动推 session_restored
 */
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AgentService } from './agent.service';
import { ClientService } from '../client/client.service';
import { QueueService } from '../queue/queue.service';
import { SessionService } from '../session/session.service';
import { HistoryService } from '../history/history.service';
import { SuggestionService } from '../suggestion/suggestion.service';
import {
  AgentMessageRecord,
  AgentMessage as AgentMessageType,
  ClientMessage as ClientMessageType,
  HistoryEndReason,
  HistorySessionItem,
  MessageRole,
  QueueReason,
  SystemEvent,
} from '../../common/types/agent-protocol';

interface ConnMeta {
  socket: Socket;
  role: 'client' | 'agent';
  id: string;
  name?: string;
  avatar?: string;
  joinedAt: number;
  alive: boolean;
}

interface SessionRuntime {
  sessionId: string;
  clientId: string;
  agentId: string;
  inactivityTimer: NodeJS.Timeout | null;
  lastSuggestions: Map<string, unknown[]>;
  activeSuggestionIntentId: string | null;
}

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})
export class AgentGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(AgentGateway.name);

  private clientConns = new Map<string, ConnMeta>();
  private agentConns = new Map<string, ConnMeta>();
  private sessionRuntimes = new Map<string, SessionRuntime>();

  constructor(
    private readonly config: ConfigService,
    private readonly agentService: AgentService,
    private readonly clientService: ClientService,
    private readonly queueService: QueueService,
    private readonly sessionService: SessionService,
    private readonly historyService: HistoryService,
    private readonly suggestionService: SuggestionService,
  ) {}

  async onModuleInit() {
    await this.historyService.prune({});
  }

  // ============== 连接生命周期 ==============

  async handleConnection(socket: Socket) {
    const role = (socket.handshake.query?.role as string) || '';
    const id =
      (socket.handshake.query?.id as string) ||
      (role === 'agent'
        ? (socket.handshake.query?.agentId as string)
        : (socket.handshake.query?.userId as string)) ||
      '';

    if (!role || !id || (role !== 'client' && role !== 'agent')) {
      this.logger.warn(`[conn] invalid handshake: role=${role} id=${id}, closing`);
      socket.emit('error', {
        type: 'error',
        code: 'invalid_handshake',
        message: 'role 和 id 必填',
      });
      socket.disconnect(true);
      return;
    }

    const meta: ConnMeta = {
      socket,
      role: role as 'client' | 'agent',
      id,
      joinedAt: Date.now(),
      alive: true,
    };

    if (role === 'agent') {
      const old = this.agentConns.get(id);
      if (old && old.socket.id !== socket.id) {
        try {
          old.socket.disconnect(true);
        } catch {
          /* noop */
        }
      }
      this.agentConns.set(id, meta);
      await this.agentService.markOnline(id);
      this.sendToAgent(meta, {
        type: 'presence',
        onlineAgents: this.agentConns.size,
        queueLength: 0,
      });
      await this.pushQueueUpdateTo(meta);
      await this.pushHistoryListToAgent(meta);

      // 增量补齐：客服断线重连后，主动遍历该客服负责的活跃会话，
      // 推 session_restored 给客户端，让 activeSessions 一次性恢复
      // 避免客服错过断线期间其他 client/agent 推的消息
      const activeSessions = await this.sessionService.listActiveByAgent(id);
      for (const sess of activeSessions) {
        const messages = await this.sessionService.listMessages(sess.id);
        const serverTs =
          messages.length > 0 ? messages[messages.length - 1].createdAt : Date.now();
        this.sendToAgent(meta, {
          type: 'session_restored',
          sessionId: sess.id,
          messages,
          serverTs,
        });
      }
    } else {
      const old = this.clientConns.get(id);
      if (old && old.socket.id !== socket.id) {
        try {
          old.socket.disconnect(true);
        } catch {
          /* noop */
        }
      }
      this.clientConns.set(id, meta);
      await this.clientService.ensure(id);
      const existing = await this.sessionService.findActiveByClient(id);
      if (existing) {
        const messages = await this.sessionService.listMessages(existing.id);
        const serverTs =
          messages.length > 0 ? messages[messages.length - 1].createdAt : Date.now();
        this.sendToClient(meta, {
          type: 'session_restored',
          sessionId: existing.id,
          messages,
          serverTs,
        });
      }
      await this.pushHistoryListToClient(meta);
    }

    this.logger.log(
      `[conn] ${role} ${id} connected (clients=${this.clientConns.size} agents=${this.agentConns.size})`,
    );
  }

  async handleDisconnect(socket: Socket) {
    const meta = this.findMetaBySocket(socket);
    if (!meta) return;
    if (meta.role === 'client') {
      this.clientConns.delete(meta.id);
      this.logger.log(`[disc] client ${meta.id} disconnected`);
    } else {
      this.agentConns.delete(meta.id);
      await this.agentService.markOffline(meta.id);
      this.logger.log(`[disc] agent ${meta.id} disconnected`);
      this.broadcastPresence();
    }
  }

  // ============== 消息入口 ==============

  @SubscribeMessage('message')
  async handleMessage(socket: Socket, raw: unknown) {
    const meta = this.findMetaBySocket(socket);
    if (!meta) return;

    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof (raw as { type?: unknown }).type !== 'string'
    ) {
      this.sendError(socket, 'invalid_payload', '消息格式错误');
      return;
    }
    const msg = raw as { type: string; [k: string]: unknown };

    if (msg.type === 'client.pong' || msg.type === 'agent.pong') {
      meta.alive = true;
      return;
    }

    try {
      if (meta.role === 'client') {
        await this.handleClientMessage(meta, msg as ClientMessageType);
      } else {
        await this.handleAgentMessage(meta, msg as AgentMessageType);
      }
    } catch (err) {
      this.logger.error(
        `[msg] ${meta.role} ${meta.id} ${msg.type} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
      this.sendError(
        socket,
        'internal_error',
        (err as Error).message || '服务器内部错误',
      );
    }
  }

  // ============== 客户端消息处理 ==============

  private async handleClientMessage(meta: ConnMeta, msg: ClientMessageType) {
    switch (msg.type) {
      case 'client.hello': {
        meta.name = msg.userName;
        meta.avatar = msg.userAvatar;
        await this.clientService.ensure(meta.id, msg.userName, msg.userAvatar);
        await this.pushHistoryListToClient(meta);
        break;
      }

      case 'client.transfer_human': {
        const existing = await this.queueService.positionOf(meta.id);
        if (existing > 0) {
          this.sendError(meta.socket, 'already_queued', '已在排队中');
          return;
        }
        const sess = await this.sessionService.findActiveByClient(meta.id);
        if (sess) {
          this.sendError(meta.socket, 'already_in_session', '已在客服会话中');
          return;
        }
        const reason = (msg.reason as QueueReason) ?? 'normal';
        await this.queueService.add({
          clientId: meta.id,
          userName: meta.name,
          userAvatar: meta.avatar,
          reason,
        });
        const pos = await this.queueService.positionOf(meta.id);
        const total = await this.queueService.count();
        this.sendToClient(meta, {
          type: 'queue_accepted',
          position: pos,
          estimatedWaitSec: this.estimateWaitSec(total),
          reason,
        });
        await this.broadcastQueue();
        await this.broadcastPresence();
        break;
      }

      case 'client.cancel_queue': {
        const removed = await this.queueService.remove(meta.id);
        if (!removed) {
          this.sendError(meta.socket, 'not_in_queue', '当前不在排队中');
          return;
        }
        this.sendToClient(meta, { type: 'queue_cancelled' });
        await this.broadcastQueue();
        await this.broadcastPresence();
        break;
      }

      case 'client.send': {
        const sess = await this.sessionService.findActiveByClient(meta.id);
        if (!sess) {
          this.sendError(meta.socket, 'not_in_session', '当前不在客服会话中');
          return;
        }
        await this.sessionService.markUserHasSpoken(sess.id);
        const msg2 = await this.sessionService.appendMessage({
          sessionId: sess.id,
          role: 'user' as MessageRole,
          parts: msg.parts as unknown[],
          messageId: msg.messageId,
        });
        const agentMeta = this.agentConns.get(sess.agentId);
        if (agentMeta) {
          this.sendToAgent(agentMeta, {
            type: 'message',
            message: msg2,
            serverTs: msg2.createdAt,
          });
          this.sendToClient(meta, {
            type: 'message_ack',
            messageId: msg2.id,
            timestamp: msg2.createdAt,
          });
          this.scheduleSuggestionForSession(sess.id, agentMeta);
        } else {
          this.sendError(meta.socket, 'agent_offline', '客服已离线');
        }
        this.resetInactivityTimer(sess.id);
        break;
      }

      case 'client.typing': {
        const sess = await this.sessionService.findActiveByClient(meta.id);
        if (!sess) return;
        const agentMeta = this.agentConns.get(sess.agentId);
        if (agentMeta) {
          this.sendToAgent(agentMeta, {
            type: 'typing',
            from: 'user',
            isTyping: !!msg.isTyping,
          });
        }
        break;
      }

      case 'client.end_session': {
        const sess = await this.sessionService.findActiveByClient(meta.id);
        if (!sess) return;
        await this.endSession(sess.id, 'user');
        break;
      }

      case 'client.fetch_history': {
        await this.pushHistoryListToClient(meta);
        break;
      }

      default:
        this.sendError(
          meta.socket,
          'unknown_type',
          `未知消息类型: ${(msg as { type: string }).type}`,
        );
    }
  }

  // ============== 客服端消息处理 ==============

  private async handleAgentMessage(meta: ConnMeta, msg: AgentMessageType) {
    switch (msg.type) {
      case 'agent.hello': {
        meta.name = msg.agentName;
        meta.avatar = msg.agentAvatar;
        await this.agentService.ensure(meta.id, msg.agentName, msg.agentAvatar);
        this.sendToAgent(meta, {
          type: 'presence',
          onlineAgents: this.agentConns.size,
          queueLength: 0,
        });
        await this.pushQueueUpdateTo(meta);
        await this.pushHistoryListToAgent(meta);
        break;
      }

      case 'agent.accept_queue': {
        const items = await this.queueService.list();
        const target = items.find((i) => i.clientId === msg.clientId);
        if (!target) {
          this.sendError(meta.socket, 'not_in_queue', '该用户已不在排队中');
          return;
        }
        const clientMeta = this.clientConns.get(msg.clientId);
        const userName = clientMeta?.name ?? target.userName;
        await this.queueService.remove(msg.clientId);
        const agent = await this.agentService.ensure(meta.id, meta.name, meta.avatar);
        const sess = await this.sessionService.create({
          clientId: msg.clientId,
          agentId: meta.id,
          userName: userName ?? undefined,
          agentName: agent.name ?? meta.name ?? undefined,
        });
        this.sessionRuntimes.set(sess.id, {
          sessionId: sess.id,
          clientId: msg.clientId,
          agentId: meta.id,
          inactivityTimer: null,
          lastSuggestions: new Map(),
          activeSuggestionIntentId: null,
        });
        if (clientMeta) {
          this.sendToClient(clientMeta, {
            type: 'queue_assigned',
            agentId: meta.id,
            agentName: agent.name ?? meta.name ?? meta.id,
            agentAvatar: agent.avatar ?? meta.avatar,
            sessionId: sess.id,
          });
        }
        // 关键：queue_assigned 必须带 clientId + userName + userAvatar。
        // 客户端 agentStore 在收到事件时直接新建 activeSession（不等后续 message 事件补全），
        // 否则新会话的 clientId='' 会让 SessionList / MessageArea / 输入区都显示"未知"/"?"，
        // 客服在 UI 上看到的就是"接单后没显示会话"。
        this.sendToAgent(meta, {
          type: 'queue_assigned',
          clientId: msg.clientId,
          userName: userName ?? undefined,
          userAvatar: clientMeta?.avatar ?? target.userAvatar,
          agentId: meta.id,
          agentName: agent.name ?? meta.name ?? meta.id,
          agentAvatar: agent.avatar ?? meta.avatar,
          sessionId: sess.id,
        });
        await this.broadcastQueue();
        await this.broadcastPresence();
        break;
      }

      case 'agent.list_pending': {
        await this.pushQueueUpdateTo(meta);
        break;
      }

      case 'agent.send': {
        const sess = await this.sessionService.findById(msg.sessionId);
        if (!sess || sess.agentId !== meta.id) {
          this.sendError(meta.socket, 'not_your_session', '无权操作该会话');
          return;
        }
        const msg2 = await this.sessionService.appendMessage({
          sessionId: sess.id,
          role: 'agent' as MessageRole,
          parts: msg.parts as unknown[],
          messageId: msg.messageId,
        });
        const clientMeta = this.clientConns.get(sess.clientId);
        if (clientMeta) {
          this.sendToClient(clientMeta, {
            type: 'message',
            message: msg2,
            serverTs: msg2.createdAt,
          });
        }
        this.sendToAgent(meta, {
          type: 'message_ack',
          messageId: msg2.id,
          timestamp: msg2.createdAt,
        });
        break;
      }

      case 'agent.typing': {
        const sess = await this.sessionService.findById(msg.sessionId);
        if (!sess || sess.agentId !== meta.id) return;
        const clientMeta = this.clientConns.get(sess.clientId);
        if (clientMeta) {
          this.sendToClient(clientMeta, {
            type: 'typing',
            from: 'agent',
            isTyping: !!msg.isTyping,
          });
        }
        break;
      }

      case 'agent.end_session': {
        const sess = await this.sessionService.findById(msg.sessionId);
        if (!sess || sess.agentId !== meta.id) return;
        await this.endSession(sess.id, (msg.reason as HistoryEndReason) ?? 'agent');
        break;
      }

      case 'agent.request_suggestions':
      case 'agent.fetch_suggestions': {
        const sess = await this.sessionService.findById(msg.sessionId);
        if (!sess || sess.agentId !== meta.id) return;
        this.scheduleSuggestionForSession(
          sess.id,
          meta,
          msg.context as AgentMessageRecord[] | undefined,
        );
        break;
      }

      case 'agent.use_suggestion': {
        const sess = await this.sessionService.findById(msg.sessionId);
        if (!sess || sess.agentId !== meta.id) {
          this.sendError(meta.socket, 'not_your_session', '无权操作该会话');
          return;
        }
        const runtime = this.sessionRuntimes.get(sess.id);
        const parts =
          runtime?.lastSuggestions.get(msg.suggestionId) ??
          ([{ type: 'text', content: '[已应用推荐话术]' }] as unknown[]);
        const message = await this.sessionService.appendMessage({
          sessionId: sess.id,
          role: 'agent' as MessageRole,
          parts,
        });
        const clientMeta = this.clientConns.get(sess.clientId);
        if (clientMeta) {
          this.sendToClient(clientMeta, { type: 'message', message, serverTs: message.createdAt });
        }
        this.sendToAgent(meta, {
          type: 'message_ack',
          messageId: message.id,
          timestamp: message.createdAt,
        });
        break;
      }

      case 'agent.fetch_history': {
        await this.pushHistoryListToAgent(meta);
        break;
      }

      case 'agent.fetch_history_session': {
        const detail = await this.historyService.findOne(msg.sessionId);
        if (!detail) {
          this.sendError(meta.socket, 'history_not_found', '历史会话不存在或已过期');
          return;
        }
        this.sendToAgent(meta, { type: 'history_session', session: detail });
        break;
      }

      default:
        this.sendError(
          meta.socket,
          'unknown_type',
          `未知消息类型: ${(msg as { type: string }).type}`,
        );
    }
  }

  // ============== 会话结束 ==============

  private async endSession(sessionId: string, reason: HistoryEndReason) {
    const sess = await this.sessionService.endSession(sessionId, reason);
    if (!sess) return;
    const runtime = this.sessionRuntimes.get(sessionId);
    if (runtime?.inactivityTimer) {
      clearTimeout(runtime.inactivityTimer);
    }
    this.sessionRuntimes.delete(sessionId);
    const messages = await this.sessionService.listMessages(sessionId);
    const detail = await this.historyService.append({
      sessionId: sess.id,
      clientId: sess.clientId,
      agentId: sess.agentId,
      userName: sess.userName ?? undefined,
      agentName: sess.agentName ?? undefined,
      startedAt: Number(sess.startedAt),
      endedAt: Number(sess.endedAt!),
      endReason: reason,
      messages,
    });
    const clientMeta = this.clientConns.get(sess.clientId);
    const agentMeta = this.agentConns.get(sess.agentId);
    if (clientMeta) this.sendToClient(clientMeta, { type: 'session_ended', reason, sessionId });
    if (agentMeta) this.sendToAgent(agentMeta, { type: 'session_ended', reason, sessionId });

    const newItem: HistorySessionItem = {
      sessionId: detail.sessionId,
      clientId: detail.clientId,
      userName: detail.userName ?? undefined,
      agentId: detail.agentId,
      agentName: detail.agentName ?? undefined,
      startedAt: Number(detail.startedAt),
      endedAt: Number(detail.endedAt),
      endReason: detail.endReason,
      messageCount: detail.messageCount,
      lastUserMessage: detail.lastUserMessage ?? undefined,
      lastAgentMessage: detail.lastAgentMessage ?? undefined,
    };
    if (agentMeta) this.sendToAgent(agentMeta, { type: 'history_list', items: [newItem] });
    if (clientMeta) this.sendToClient(clientMeta, { type: 'history_list', items: [newItem] });

    setTimeout(() => {
      this.sessionRuntimes.delete(sessionId);
    }, 30_000);
    this.historyService.prune({ agentId: sess.agentId }).catch(() => undefined);
    this.historyService.prune({ clientId: sess.clientId }).catch(() => undefined);
  }

  // ============== 30s 用户静默计时器 ==============

  private resetInactivityTimer(sessionId: string) {
    const sess = this.sessionRuntimes.get(sessionId);
    if (!sess) return;
    this.sessionService
      .findById(sessionId)
      .then((dbSess) => {
        if (!dbSess || !dbSess.userHasSpoken) return;
        if (sess.inactivityTimer) clearTimeout(sess.inactivityTimer);
        sess.inactivityTimer = setTimeout(() => {
          this.sessionService
            .findById(sessionId)
            .then((current) => {
              if (current && current.status === 'inSession') {
                this.logger.log(`[ws] session ${sessionId} 30s 用户静默，自动结束`);
                this.endSession(sessionId, 'timeout').catch((err) =>
                  this.logger.error('endSession failed', err),
                );
              }
            })
            .catch(() => undefined);
        }, this.config.get<number>('business.userInactivityTimeoutMs')!);
      })
      .catch(() => undefined);
  }

  // ============== 推荐话术调度 ==============

  private scheduleSuggestionForSession(
    sessionId: string,
    agentMeta: ConnMeta,
    context?: AgentMessageRecord[],
  ) {
    this.sessionService
      .findById(sessionId)
      .then(async (dbSess) => {
        if (!dbSess || dbSess.status !== 'inSession' || dbSess.agentId !== agentMeta.id) {
          return;
        }
        const messages = context ?? (await this.sessionService.listMessages(sessionId));
        const runtime = this.sessionRuntimes.get(sessionId);
        this.suggestionService.scheduleStream(
          sessionId,
          messages,
          this.config.get<number>('business.suggestionDelayMs')!,
          {
            start: (intentId, category) => {
              if (runtime) runtime.activeSuggestionIntentId = intentId;
              this.sendToAgent(agentMeta, {
                type: 'suggestion_start',
                intentId,
                category,
              });
            },
            chunk: (intentId, chunk, done) => {
              this.sendToAgent(agentMeta, {
                type: 'suggestion_chunk',
                intentId,
                chunk,
                done,
              });
            },
            done: (intentId, parts) => {
              if (runtime) {
                runtime.lastSuggestions.set(intentId, parts);
                runtime.activeSuggestionIntentId = null;
              }
            },
            isValid: () => !!this.sessionRuntimes.get(sessionId),
          },
        );
      })
      .catch((err) => this.logger.error('scheduleSuggestion failed', err));
  }

  // ============== 广播辅助 ==============

  private async broadcastQueue() {
    const items = await this.queueService.list();
    for (const meta of this.agentConns.values()) {
      this.sendToAgent(meta, { type: 'queue_update', items });
    }
  }

  private async broadcastPresence() {
    const queueLength = await this.queueService.count();
    const data = {
      type: 'presence' as const,
      onlineAgents: this.agentConns.size,
      queueLength,
    };
    for (const meta of this.agentConns.values()) {
      this.sendToAgent(meta, data);
    }
  }

  private async pushQueueUpdateTo(meta: ConnMeta) {
    const items = await this.queueService.list();
    this.sendToAgent(meta, { type: 'queue_update', items });
  }

  private async pushHistoryListToAgent(meta: ConnMeta) {
    await this.historyService.prune({ agentId: meta.id });
    const items = await this.historyService.listForAgent(meta.id);
    this.sendToAgent(meta, { type: 'history_list', items });
  }

  private async pushHistoryListToClient(meta: ConnMeta) {
    await this.historyService.prune({ clientId: meta.id });
    const items = await this.historyService.listForClient(meta.id);
    this.sendToClient(meta, { type: 'history_list', items });
  }

  // ============== 发送辅助 ==============

  private sendToClient(meta: ConnMeta, event: SystemEvent) {
    if (!meta.socket.connected) return;
    meta.socket.emit(event.type, event);
  }

  private sendToAgent(meta: ConnMeta, event: SystemEvent) {
    if (!meta.socket.connected) return;
    meta.socket.emit(event.type, event);
  }

  private sendError(socket: Socket, code: string, message: string) {
    if (socket.connected) {
      socket.emit('error', { type: 'error', code, message });
    }
  }

  // ============== 工具 ==============

  private findMetaBySocket(socket: Socket): ConnMeta | undefined {
    for (const meta of this.clientConns.values()) {
      if (meta.socket.id === socket.id) return meta;
    }
    for (const meta of this.agentConns.values()) {
      if (meta.socket.id === socket.id) return meta;
    }
    return undefined;
  }

  private estimateWaitSec(queueLen: number): number {
    const onlineAgents = Math.max(1, this.agentConns.size);
    return Math.ceil((queueLen / onlineAgents) * 60);
  }

  getStats() {
    return {
      clients: this.clientConns.size,
      agents: this.agentConns.size,
      sessions: this.sessionRuntimes.size,
    };
  }
}
