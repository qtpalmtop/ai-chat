/**
 * 横屏旋转提示（移动端专属）
 *
 * 触发条件（必须同时满足）：
 *   1. 是真正的移动设备：用 navigator.userAgent + maxTouchPoints 判定
 *      （**不要**用 viewport width 判定——桌面浏览器窗口被缩窄时会误判）
 *   2. 处于横屏：window.matchMedia('(orientation: landscape)').matches
 *
 * 实现：
 *   - 监听 matchMedia('(orientation: landscape)') 的 change 事件（iOS Safari / Android Chrome 均支持）
 *   - 兜底：监听 orientationchange + resize，兼容旧版浏览器
 *   - 初次挂载时立即同步一次（避免页面打开时已经横屏但没触发 change）
 *
 * 不放在 ChatWindow / AgentWorkbench 里——这俩组件可能因路由切换 unmount，
 * 旋转提示应当跨页面持续生效。放在 App.vue 全局。
 */

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { Modal } from 'ant-design-vue';
import { MobileOutlined } from '@ant-design/icons-vue';

/**
 * 检测是否是真正的移动设备
 *
 * ❌ 之前用 `window.matchMedia('(max-width: 1024px)')` 判定——这是错的：
 *    桌面浏览器窗口被用户缩到 ≤ 1024px（分屏、小窗口）时，会被误判成 mobile。
 *    然后 `matchMedia('(orientation: landscape)')` 在 PC 窗口下默认 true（横屏），
 *    两者一组合 → 弹窗立刻弹出 → 桌面用户被骚扰。
 *
 * ✅ 真正的移动设备 = UA 关键字 + 触屏能力：
 *    - UA 含 Mobi/Android/iPhone/iPod 等（W3C 推荐的 mobile 判定关键字）
 *    - iPadOS 13+ 把 UA 改成 Mac，用 `maxTouchPoints > 1` 兜底
 *    - 这样不管桌面浏览器窗口多窄，UA 没关键字就不会误判
 */
function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  // 1. 标准 mobile UA：Mobi 是 W3C 推荐的判定关键字
  if (/Mobi|Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  // 2. iPadOS 13+ 在 Safari 把 UA 伪装成 Mac，用 maxTouchPoints 兜底
  if (/Mac/.test(navigator.platform || '') && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}

const isMobile = computed(() => detectMobile());

const isLandscape = ref(false);
let orientationMql: MediaQueryList | null = null;

function checkOrientation(e?: MediaQueryListEvent | MediaQueryList) {
  if (e) {
    isLandscape.value = e.matches;
    return;
  }
  // fallback：用宽高比判定（极个别不支持 orientation media query 的设备）
  isLandscape.value = window.innerWidth > window.innerHeight;
}

onMounted(() => {
  // 横屏检测
  orientationMql = window.matchMedia('(orientation: landscape)');
  checkOrientation(orientationMql);
  // orientation：iOS Safari 16+ / Android Chrome 都支持 change 事件；
  // 老设备用 addListener 兜底（Safari 13 之前）
  if (orientationMql.addEventListener) {
    orientationMql.addEventListener('change', checkOrientation);
  } else if (orientationMql.addListener) {
    orientationMql.addListener(checkOrientation);
  }

  // 兜底：orientationchange 在某些 WebView 里更可靠；resize 兜底桌面浏览器
  window.addEventListener('orientationchange', onOrientationFallback);
  window.addEventListener('resize', onOrientationFallback);
});

onUnmounted(() => {
  if (orientationMql) {
    if (orientationMql.removeEventListener) {
      orientationMql.removeEventListener('change', checkOrientation);
    } else if (orientationMql.removeListener) {
      orientationMql.removeListener(checkOrientation);
    }
  }
  window.removeEventListener('orientationchange', onOrientationFallback);
  window.removeEventListener('resize', onOrientationFallback);
});

/** 兜底：旋转/缩放事件触发后 200ms 再读一次（Safari 转屏动画期间取宽高可能拿到中间值） */
let fallbackTimer: number | null = null;
function onOrientationFallback() {
  if (fallbackTimer != null) clearTimeout(fallbackTimer);
  fallbackTimer = window.setTimeout(() => {
    checkOrientation();
    fallbackTimer = null;
  }, 200);
}

/** 仅在 mobile + landscape 同时满足时显示 */
const visible = computed(() => isMobile.value && isLandscape.value);
</script>

<template>
  <Modal
    :open="visible"
    :closable="false"
    :mask-closable="false"
    :keyboard="false"
    :footer="null"
    :width="300"
    :mask-style="{ backgroundColor: 'rgba(15, 23, 42, 0.85)' }"
    centered
    wrap-class-name="rotate-hint-modal"
  >
    <div class="rotate-hint">
      <div class="rotate-hint__icon">
        <MobileOutlined :rotate="-90" />
      </div>
      <div class="rotate-hint__title">请旋转手机</div>
      <div class="rotate-hint__desc">
        为了获得更好的体验<br />
        请将手机旋转为竖屏模式
      </div>
    </div>
  </Modal>
</template>

<style>
/* 弹窗本体：圆角 + 居中图标 + 文字 */
.rotate-hint-modal .ant-modal-content {
  border-radius: 16px;
  padding: 28px 16px;
  text-align: center;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.rotate-hint-modal .ant-modal-body {
  padding: 0;
}
.rotate-hint__icon {
  font-size: 56px;
  color: #4d6bfe;
  margin-bottom: 12px;
  animation: rotate-hint-shake 2s ease-in-out infinite;
  display: inline-block;
  /* 让动画从左→右摆动（手机想回到竖屏的隐喻） */
}
@keyframes rotate-hint-shake {
  0%, 100% { transform: rotate(-15deg); }
  50% { transform: rotate(15deg); }
}
.rotate-hint__title {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 8px;
}
.rotate-hint__desc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.6;
}
</style>
