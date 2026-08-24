/**
 * ChartCard - 图表卡片(纯 SVG 实现,零依赖)
 * - 独立文件:按需加载(数据分析场景)
 * - 此文件较大(~250 行),拆出可显著降低初始包大小
 */
import React from 'react';
import type { ChartData } from '@/types/message';

const ChartCardImpl: React.FC<{ chartType: 'bar' | 'line' | 'pie' | 'radar'; title?: string; data: ChartData }> = ({
  chartType,
  title,
  data,
}) => {
  const W = 480;
  const H = 240;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(...data.values, 1);

  return (
    <div className="part-chart">
      {title && <div className="part-chart__title">{title}</div>}
      <svg className="part-chart__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#e6e8ee" />
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#e6e8ee" />

        {chartType === 'bar' &&
          data.labels.map((label, i) => {
            const v = data.values[i] || 0;
            const x = PAD_L + ((i + 0.5) * innerW) / data.labels.length - 14;
            const y = PAD_T + innerH * (1 - v / max);
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={28}
                  height={H - PAD_B - y}
                  rx={4}
                  fill="url(#barGrad)"
                />
                <text x={x + 14} y={y - 4} textAnchor="middle" fontSize="11" fill="#1d2129">
                  {v}
                  {data.unit || ''}
                </text>
                <text x={x + 14} y={H - PAD_B + 16} textAnchor="middle" fontSize="11" fill="#6b7280">
                  {label}
                </text>
              </g>
            );
          })}

        {chartType === 'line' &&
          (() => {
            const points = data.values.map((v, i) => {
              const x = PAD_L + (i * innerW) / Math.max(data.values.length - 1, 1);
              const y = PAD_T + innerH * (1 - v / max);
              return [x, y] as const;
            });
            const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
            return (
              <>
                <path d={path} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" />
                {points.map(([x, y], i) => (
                  <g key={i}>
                    <circle cx={x} cy={y} r="4" fill="#4d6bfe" />
                    <text x={x} y={H - PAD_B + 16} textAnchor="middle" fontSize="11" fill="#6b7280">
                      {data.labels[i]}
                    </text>
                    <text x={x} y={y - 8} textAnchor="middle" fontSize="11" fill="#1d2129">
                      {data.values[i]}
                      {data.unit || ''}
                    </text>
                  </g>
                ))}
              </>
            );
          })()}

        {chartType === 'pie' &&
          (() => {
            const total = data.values.reduce((a, b) => a + b, 0) || 1;
            const cx = PAD_L + innerW / 2;
            const cy = PAD_T + innerH / 2;
            const r = Math.min(innerW, innerH) / 2 - 10;
            let acc = 0;
            const colors = ['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'];
            return (
              <>
                {data.values.map((v, i) => {
                  const start = (acc / total) * Math.PI * 2 - Math.PI / 2;
                  acc += v;
                  const end = (acc / total) * Math.PI * 2 - Math.PI / 2;
                  const large = end - start > Math.PI ? 1 : 0;
                  const x1 = cx + r * Math.cos(start);
                  const y1 = cy + r * Math.sin(start);
                  const x2 = cx + r * Math.cos(end);
                  const y2 = cy + r * Math.sin(end);
                  return (
                    <path
                      key={i}
                      d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`}
                      fill={colors[i % colors.length]}
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </>
            );
          })()}

        {chartType === 'radar' &&
          (() => {
            const n = data.labels.length;
            const cx = PAD_L + innerW / 2;
            const cy = PAD_T + innerH / 2 + 4;
            const r = Math.min(innerW, innerH) / 2 - 24;
            const angle = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
            const rings = [0.33, 0.66, 1];
            return (
              <>
                {rings.map((rr, ri) => {
                  const pts = Array.from({ length: n }, (_, i) => {
                    const a = angle(i);
                    return [cx + r * rr * Math.cos(a), cy + r * rr * Math.sin(a)] as const;
                  });
                  const d = pts
                    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`)
                    .join(' ') + ' Z';
                  return (
                    <path
                      key={ri}
                      d={d}
                      fill="none"
                      stroke="#e6e8ee"
                      strokeDasharray={ri === rings.length - 1 ? '0' : '3 3'}
                    />
                  );
                })}
                {data.labels.map((_, i) => {
                  const a = angle(i);
                  return (
                    <line
                      key={i}
                      x1={cx}
                      y1={cy}
                      x2={cx + r * Math.cos(a)}
                      y2={cy + r * Math.sin(a)}
                      stroke="#e6e8ee"
                    />
                  );
                })}
                {(() => {
                  const dataPts = data.values.map((v, i) => {
                    const a = angle(i);
                    const rr = v / max;
                    return [cx + r * rr * Math.cos(a), cy + r * rr * Math.sin(a)] as const;
                  });
                  const d =
                    dataPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ') + ' Z';
                  return (
                    <>
                      <path
                        d={d}
                        fill="rgba(77, 107, 254, 0.18)"
                        stroke="#4d6bfe"
                        strokeWidth="2"
                      />
                      {dataPts.map(([x, y], i) => (
                        <circle key={i} cx={x} cy={y} r="3" fill="#4d6bfe" />
                      ))}
                    </>
                  );
                })()}
                {data.labels.map((label, i) => {
                  const a = angle(i);
                  const lx = cx + (r + 14) * Math.cos(a);
                  const ly = cy + (r + 14) * Math.sin(a);
                  return (
                    <text
                      key={i}
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fill="#6b7280"
                    >
                      {label}
                    </text>
                  );
                })}
                {data.values.map((v, i) => {
                  const a = angle(i);
                  const rr = v / max;
                  const dx = cx + r * rr * Math.cos(a);
                  const dy = cy + r * rr * Math.sin(a);
                  return (
                    <text key={i} x={dx} y={dy - 8} textAnchor="middle" fontSize="10" fill="#1d2129">
                      {v}
                      {data.unit || ''}
                    </text>
                  );
                })}
              </>
            );
          })()}

        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7b5cff" />
            <stop offset="100%" stopColor="#4d6bfe" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#4d6bfe" />
            <stop offset="100%" stopColor="#7b5cff" />
          </linearGradient>
        </defs>
      </svg>
      {chartType === 'pie' && (
        <div className="part-chart__legend">
          {data.labels.map((label, i) => {
            const colors = ['#4d6bfe', '#7b5cff', '#34d399', '#f59e0b', '#ef4444', '#06b6d4'];
            return (
              <span key={i} className="part-chart__legend-item">
                <i style={{ background: colors[i % colors.length] }} />
                {label} {data.values[i]}
                {data.unit || ''}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChartCardImpl;
