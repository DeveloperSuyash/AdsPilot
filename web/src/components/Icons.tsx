// Hand-rolled 24px stroke icons, same set and same weight as DevPilot's — one import,
// no icon package, and the two apps look like siblings.
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const Icon = {
  Dashboard: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>
  ),
  // A project is a website, so it gets a browser window. The people glyph this used to
  // be moved to `People`, where it was always what it actually drew.
  Projects: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></svg>
  ),
  People: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-5-6.7"/></svg>
  ),
  ListChecks: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="m3 6 2 2 3-3M3 14l2 2 3-3M12 7h9M12 15h9"/></svg>
  ),
  Mic: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/></svg>
  ),
  Image: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
  ),
  Paperclip: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M21 12.5 12 21a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/></svg>
  ),
  Sparkles: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>
  ),
  Settings: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>
  ),
  Help: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
  ),
  Search: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
  ),
  Globe: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
  ),
  Plus: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14"/></svg>
  ),
  Check: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M20 6 9 17l-5-5"/></svg>
  ),
  X: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>
  ),
  ChevronDown: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="m6 9 6 6 6-6"/></svg>
  ),
  ChevronRight: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="m9 6 6 6-6 6"/></svg>
  ),
  ArrowLeft: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
  ),
  ExternalLink: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
  ),
  Refresh: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
  ),
  Sun: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  ),
  Moon: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
  ),
  Logout: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
  ),
  Lock: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
  ),
  AlertTriangle: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01"/></svg>
  ),
  // An incident, not a warning. AlertTriangle already means "needs attention" on the
  // overview, which is a state derived from the latest sync — a bell is a thing that
  // happened at a moment, and the two must not read as the same control.
  Bell: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
  ),
  Clock: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
  ),
  Activity: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
  ),
  Gauge: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 14 16 9"/><path d="M5 19a9 9 0 1 1 14 0"/></svg>
  ),
  TrendUp: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="m3 17 6-6 4 4 8-8M15 7h6v6"/></svg>
  ),
  TrendDown: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="m3 7 6 6 4-4 8 8M15 17h6v-6"/></svg>
  ),
  Upload: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 17V5M7 10l5-5 5 5M5 21h14"/></svg>
  ),
  Trash: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
  ),
  Link: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
  ),
  FileSearch: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6"/><path d="M14 2v6h6"/><circle cx="17" cy="16" r="3"/><path d="m21 20-1.5-1.5"/></svg>
  ),
  Click: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M9 9l10 4-4 1.5L13.5 19 9 9Z"/><path d="M6 3v3M3 6h3M4.6 12.4 6.7 10.3"/></svg>
  ),
  Bolt: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/></svg>
  ),
  Send: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/></svg>
  ),
  Menu: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>
  ),
  Shield: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
  ),
  Database: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/></svg>
  ),
  Eye: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  Plug: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5"/></svg>
  ),
  Tag: ({ size = 18, ...p }: IconProps) => (
    <svg {...base(size)} {...p}><path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/></svg>
  ),
}
