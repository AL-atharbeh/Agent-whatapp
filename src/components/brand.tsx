/**
 * هوية «حاضر» — HADER.
 *
 * العلامة مبنية كـ SVG من اللوجو الأصلي (رأس مربّع بزوايا ناعمة، وجه داكن
 * مائل قليلاً، عينان عموديتان، ومسّاح بنقطة). النقطة هي "نبض الحضور": تنبض
 * بلون الاتصال الأخضر — الحركة الوحيدة في العلامة، وهي تحمل معنى الاسم.
 */

export function Mark({
  size = 32,
  pulse = true,
  className = "",
}: {
  size?: number;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      className={`brand-svg ${className}`}
    >
      {/* المسّاح */}
      <line
        x1="66"
        y1="36"
        x2="66"
        y2="18"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="66" cy="13" r="9" fill="currentColor" className={pulse ? "antenna-dot" : ""} />
      {pulse && <circle cx="66" cy="13" r="9" className="antenna-ring" />}

      {/* الرأس */}
      <path
        d="M26 48c0-9 7-16 16-16h46c9 0 16 7 16 16v40c0 9-7 16-16 16H42c-9 0-16-7-16-16V48z"
        fill="currentColor"
      />

      {/* الوجه — مائل ٦° كما في اللوجو */}
      <g transform="rotate(-6 65 66)">
        <rect x="38" y="48" width="54" height="36" rx="11" className="brand-face" />
        <rect x="52" y="57" width="7" height="17" rx="3.5" fill="currentColor" />
        <rect x="69" y="57" width="7" height="17" rx="3.5" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="HADER">
      HADER
    </span>
  );
}

export function Logo({
  size = 30,
  arabic = true,
  className = "",
}: {
  size?: number;
  arabic?: boolean;
  className?: string;
}) {
  return (
    <span className={`logo ${className}`}>
      <Mark size={size} />
      <span className="logo-text">
        <Wordmark />
        {arabic && <span className="logo-ar">حاضر</span>}
      </span>
    </span>
  );
}
