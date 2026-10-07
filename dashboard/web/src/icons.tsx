// A small stroke icon set, drawn on a 20-unit grid at 1.6 stroke.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, rest: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...rest,
});
const icon = (d: React.ReactNode) => ({ size = 18, ...rest }: P) => <svg {...base(size, rest)}>{d}</svg>;

export const Inbox = icon(<><path d="M3 11.5V15a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 17 15v-3.5" /><path d="M3 11.5 5 4.5h10l2 7h-4l-1 2H8l-1-2H3Z" /></>);
export const Send = icon(<><path d="M17 3 9 11" /><path d="M17 3 12 17l-3-6-6-3 14-5Z" /></>);
export const FileText = icon(<><path d="M11.5 2.5H5.5A1.5 1.5 0 0 0 4 4v12a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 16V7l-4.5-4.5Z" /><path d="M11.5 2.5V7H16M7 11h6M7 14h4" /></>);
export const Archive = icon(<><rect x="2.5" y="3.5" width="15" height="4" rx="1" /><path d="M4 7.5V15a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15V7.5M8 11h4" /></>);
export const Trash = icon(<><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l.8 10.6A1.5 1.5 0 0 0 7.3 17.5h5.4a1.5 1.5 0 0 0 1.5-1.4L15 5.5" /></>);
export const Ban = icon(<><circle cx="10" cy="10" r="7" /><path d="m5 5 10 10" /></>);
export const Star = icon(<path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7L10 2.8Z" />);
export const Search = icon(<><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.8 3.8" /></>);
export const Plus = icon(<path d="M10 4v12M4 10h12" />);
export const Pencil = icon(<><path d="M13.5 3.5a2 2 0 0 1 2.8 2.8L7 15.6l-3.5.9.9-3.5 9.1-9.5Z" /></>);
export const Settings = icon(<><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M2.5 10h2M15.5 10h2M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>);
export const Sparkle = icon(<><path d="M10 2.5 11.6 7.4 16.5 9 11.6 10.6 10 15.5 8.4 10.6 3.5 9 8.4 7.4 10 2.5Z" /><path d="M15.5 13.5v3M14 15h3" /></>);
export const Paperclip = icon(<path d="m16 9.5-6 6a3.5 3.5 0 0 1-5-5l6.5-6.5a2.3 2.3 0 0 1 3.3 3.3L8.3 13.8a1.2 1.2 0 0 1-1.7-1.7l5.9-5.9" />);
export const Reply = icon(<><path d="M8 5 3.5 9.5 8 14" /><path d="M3.5 9.5H12a4.5 4.5 0 0 1 4.5 4.5v1" /></>);
export const ReplyAll = icon(<><path d="M9.5 5 5 9.5 9.5 14" /><path d="M5.5 5 1 9.5 5.5 14" /><path d="M5 9.5h7.5A4.5 4.5 0 0 1 17 14v1" /></>);
export const Forward = icon(<><path d="M12 5l4.5 4.5L12 14" /><path d="M16.5 9.5H8A4.5 4.5 0 0 0 3.5 14v1" /></>);
export const More = icon(<><circle cx="5" cy="10" r=".8" fill="currentColor" /><circle cx="10" cy="10" r=".8" fill="currentColor" /><circle cx="15" cy="10" r=".8" fill="currentColor" /></>);
export const Check = icon(<path d="m4.5 10.5 3.5 3.5 7.5-8" />);
export const X = icon(<path d="m5 5 10 10M15 5 5 15" />);
export const ChevronDown = icon(<path d="m5.5 8 4.5 4.5L14.5 8" />);
export const ChevronLeft = icon(<path d="M12 4.5 6.5 10l5.5 5.5" />);
export const ChevronRight = icon(<path d="M8 4.5l5.5 5.5L8 15.5" />);
export const Alert = icon(<><path d="M10 3 2.5 16.5h15L10 3Z" /><path d="M10 8v4M10 14.2v.1" /></>);
export const Globe = icon(<><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3Z" /></>);
export const Key = icon(<><circle cx="7" cy="13" r="3.5" /><path d="m9.5 10.5 7-7M14 6l2 2M12 8l1.5 1.5" /></>);
export const Bolt = icon(<path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" />);
export const At = icon(<><circle cx="10" cy="10" r="3" /><path d="M13 10v1.3a2.2 2.2 0 0 0 4.4 0V10A7.4 7.4 0 1 0 14 16.3" /></>);
export const Folder = icon(<path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3.5l1.5 2H16a1.5 1.5 0 0 1 1.5 1.5V14a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14V5.5Z" />);
export const Tag = icon(<><path d="M3 10.6V4a1 1 0 0 1 1-1h6.6l6.4 6.4a1.3 1.3 0 0 1 0 1.8l-4.8 4.8a1.3 1.3 0 0 1-1.8 0L3 10.6Z" /><circle cx="7" cy="7" r="1" /></>);
export const Moon = icon(<path d="M16.5 12A7 7 0 1 1 8 3.5a5.5 5.5 0 0 0 8.5 8.5Z" />);
export const Sun = icon(<><circle cx="10" cy="10" r="3.2" /><path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1 1M14.7 14.7l1 1M4.3 15.7l1-1M14.7 5.3l1-1" /></>);
export const Monitor = icon(<><rect x="2.5" y="3.5" width="15" height="10" rx="1.5" /><path d="M7 17h6M10 13.5V17" /></>);
export const Menu = icon(<path d="M3 5.5h14M3 10h14M3 14.5h14" />);
export const Command = icon(<path d="M7 7V5.5A1.5 1.5 0 1 0 5.5 7H7Zm0 0h6m-6 0v6m6-6V5.5A1.5 1.5 0 1 1 14.5 7H13Zm0 0v6m0 0v1.5a1.5 1.5 0 1 0 1.5-1.5H13Zm0 0H7m0 0v1.5A1.5 1.5 0 1 1 5.5 13H7Z" />);
export const Eye = icon(<><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" /><circle cx="10" cy="10" r="2.3" /></>);
export const Image = icon(<><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><circle cx="7" cy="8" r="1.4" /><path d="m17.5 13-4-4-8 7.5" /></>);
export const Mail = icon(<><rect x="2.5" y="4" width="15" height="12" rx="1.6" /><path d="m3.5 5.5 6.5 5 6.5-5" /></>);
export const LogOut = icon(<><path d="M8 17H4.5A1.5 1.5 0 0 1 3 15.5v-11A1.5 1.5 0 0 1 4.5 3H8M13 14l4-4-4-4M17 10H8" /></>);
export const Refresh = icon(<><path d="M16.5 9.5a6.5 6.5 0 1 1-1.9-4.6M16.5 3v3.5H13" /></>);
export const Copy = icon(<><rect x="6.5" y="6.5" width="10" height="10" rx="1.5" /><path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5" /></>);
export const Download = icon(<><path d="M10 3v10M6 9l4 4 4-4M3.5 16.5h13" /></>);
export const Undo = icon(<><path d="M5 8h8a4 4 0 0 1 0 8H8" /><path d="M8 4.5 4.5 8 8 11.5" /></>);
export const Bold = icon(<path d="M6 4h5a3 3 0 0 1 0 6H6V4Zm0 6h6a3 3 0 0 1 0 6H6v-6Z" />);
export const Italic = icon(<path d="M12 4H8.5M11.5 16H8M11 4 9 16" />);
export const List = icon(<><path d="M8 5.5h9M8 10h9M8 14.5h9" /><circle cx="4" cy="5.5" r=".7" fill="currentColor" /><circle cx="4" cy="10" r=".7" fill="currentColor" /><circle cx="4" cy="14.5" r=".7" fill="currentColor" /></>);
export const Link = icon(<><path d="M8.5 11.5a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-.8.8" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l.8-.8" /></>);
export const Quote = icon(<path d="M4 9.5h3.5V14H4V9.5Zm0 0C4 7 5 5.5 7 5M11.5 9.5H15V14h-3.5V9.5Zm0 0c0-2.5 1-4 3-4.5" />);
export const Shield = icon(<path d="M10 2.5 4 5v4.5c0 3.8 2.5 6.6 6 8 3.5-1.4 6-4.2 6-8V5l-6-2.5Z" />);
export const Activity = icon(<path d="M2.5 10h3l2-5 5 10 2-5h3" />);
export const User = icon(<><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17a6.5 6.5 0 0 1 13 0" /></>);
export const Building = icon(<><rect x="4" y="2.5" width="12" height="15" rx="1.2" /><path d="M7.5 6h1.5M11 6h1.5M7.5 9h1.5M11 9h1.5M7.5 12h1.5M11 12h1.5M8.5 17.5v-2.5h3v2.5" /></>);
export const Rules = icon(<><path d="M3 5h8M3 10h5M3 15h8" /><circle cx="14.5" cy="5" r="2" /><circle cx="11.5" cy="10" r="2" /><circle cx="14.5" cy="15" r="2" /></>);
export const Reply2 = Reply;
