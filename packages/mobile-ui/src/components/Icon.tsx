import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  BarChart3,
  Camera,
  Check,
  ChevronRight,
  CircleSlash,
  CreditCard,
  Delete,
  History,
  Infinity as InfinityIcon,
  LayoutGrid,
  Loader2,
  Lock,
  LogOut,
  Minus,
  Package,
  Pause,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  ScanBarcode,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Star,
  Trash2,
  Undo2,
  User,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react-native'
import { useTheme } from '../theme/ThemeProvider'

// One shared registry so screens never import lucide directly — the app-wide
// icon language stays consistent and swappable.
const ICONS = {
  alert: AlertTriangle,
  banknote: Banknote,
  barChart: BarChart3,
  camera: Camera,
  cart: ShoppingCart,
  cashIn: ArrowDownCircle,
  cashOut: ArrowUpCircle,
  check: Check,
  chevronRight: ChevronRight,
  creditCard: CreditCard,
  backspace: Delete,
  dashboard: LayoutGrid,
  edit: Pencil,
  history: History,
  infinity: InfinityIcon,
  loader: Loader2,
  lock: Lock,
  logout: LogOut,
  minus: Minus,
  none: CircleSlash,
  package: Package,
  pause: Pause,
  plus: Plus,
  printer: Printer,
  refresh: RefreshCw,
  refund: Undo2,
  sales: ShoppingBag,
  scan: ScanBarcode,
  search: Search,
  settings: Settings,
  star: Star,
  trash: Trash2,
  user: User,
  users: Users,
  wallet: Wallet,
  wifi: Wifi,
  wifiOff: WifiOff,
  x: X,
} as const

export type IconName = keyof typeof ICONS

export interface IconProps {
  name: IconName
  size?: 14 | 16 | 20 | 24 | 28 | 32
  color?: string
  strokeWidth?: number
}

export function Icon({ name, size = 20, color, strokeWidth = 2 }: IconProps) {
  const theme = useTheme()
  const Cmp = ICONS[name]
  return <Cmp size={size} color={color ?? theme.text} strokeWidth={strokeWidth} />
}
