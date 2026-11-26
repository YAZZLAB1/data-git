import {
  Baby, Bike, Book, Briefcase, Car, CircleDashed, Clapperboard, Coffee, Dog, Dumbbell, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, Home,
  Landmark, Laptop, Music, Plane, PlusCircle, Receipt, Repeat, Shield, Shirt, ShoppingBag, ShoppingBasket, Smartphone, Sparkles, TrendingUp,
  Utensils, Wifi, Wrench, Zap, ArrowLeftRight, SlidersHorizontal, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  home: Home, "shopping-basket": ShoppingBasket, utensils: Utensils, car: Car, zap: Zap, "shopping-bag": ShoppingBag, clapperboard: Clapperboard,
  "heart-pulse": HeartPulse, repeat: Repeat, "graduation-cap": GraduationCap, plane: Plane, sparkles: Sparkles, shield: Shield, gift: Gift,
  receipt: Receipt, "circle-dashed": CircleDashed, briefcase: Briefcase, laptop: Laptop, "trending-up": TrendingUp, "plus-circle": PlusCircle,
  baby: Baby, dog: Dog, dumbbell: Dumbbell, coffee: Coffee, fuel: Fuel, wifi: Wifi, smartphone: Smartphone, book: Book, music: Music,
  gamepad: Gamepad2, landmark: Landmark, wrench: Wrench, shirt: Shirt, bike: Bike, transfer: ArrowLeftRight, adjustment: SlidersHorizontal,
};

export function CategoryIcon({ icon, color, size = "md", className }: { icon?: string | null; color?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = ICONS[icon ?? ""] ?? CircleDashed;
  const dims = { sm: "h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5", md: "h-8 w-8 [&_svg]:h-4 [&_svg]:w-4", lg: "h-10 w-10 [&_svg]:h-5 [&_svg]:w-5" }[size];
  const c = color ?? "#8a8a8a";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", dims, className)} style={{ backgroundColor: `${c}1f`, color: c }}>
      <Icon />
    </span>
  );
}

export const ICON_NAMES = Object.keys(ICONS).filter((k) => k !== "transfer" && k !== "adjustment");
export function IconByName({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? CircleDashed;
  return <Icon className={className} />;
}
