/** Tsumu のマーク（ログイン画面・ホームで使う） */
export default function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label="Tsumu"
    >
      <defs>
        <linearGradient id="brand-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f74e6" />
          <stop offset="1" stopColor="#0b57d0" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#brand-mark-bg)" />
      {/* 画面（上のバー・左のパネル）と、選択枠の角 */}
      <rect x="9.5" y="11" width="21" height="18" rx="3.5" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M9.5 16.5h21M15.5 16.5V29" stroke="#fff" strokeWidth="2" />
      <rect x="19" y="20" width="8" height="5.5" rx="1.2" fill="#fff" opacity="0.9" />
    </svg>
  );
}
