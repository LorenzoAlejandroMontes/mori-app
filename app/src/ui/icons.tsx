// Icons used in more than one place. One family: 24-unit grid, round caps,
// stroke 1.8, drawn at 16 px unless said otherwise. Always decorative
// (aria-hidden): the control that holds an icon carries the name.

type P = { size?: number };
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function LockIcon({ open = false, size = 14 }: { open?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d={open ? "M8 10.5V7a4 4 0 0 1 7.6-1.7" : "M8 10.5V7a4 4 0 0 1 8 0v3.5"} />
    </svg>
  );
}

export const IconToday = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const IconChat = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
);
export const IconTodo = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg>
);
export const IconPeople = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
export const IconCalls = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);
export const IconSearch = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const IconSettings = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
);
export const IconSidebar = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></svg>
);
export const IconKeyboard = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" /></svg>
);
export const IconPlus = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconClose = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconAlert = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
);
export const IconBack = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M15 18l-6-6 6-6" /></svg>
);
export const IconMore = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>
);
export const IconMail = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
);
export const IconCopy = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
export const IconTrash = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
);
export const IconPencil = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
);
export const IconSend = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>
);
export const IconFile = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
);
export const IconWave = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M3 10v4M7 6v12M11 3v18M15 8v8M19 11v2" /></svg>
);
export const IconUser = ({ size = 16 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></svg>
);
export const IconSun = IconToday;
export const IconMoon = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
);
export const IconArrowRight = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconCheck = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconChevron = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M9 18l6-6-6-6" /></svg>
);
export const IconCalendar = ({ size = 16 }: P) => (
  <svg {...base(size)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const IconMerge = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M8 7h8" /><path d="M8 7a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v3" /><path d="M13 17l3 3 3-3" /></svg>
);
export const IconRefresh = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
);
