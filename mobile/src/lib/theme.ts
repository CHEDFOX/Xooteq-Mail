// The Xooteq Mail palette, the same one the web app uses (dashboard/web/src/app.css),
// in the shape React Native wants: one object per scheme, picked by useTheme().
import { useColorScheme } from "react-native";

export type Theme = typeof light;

export const light = {
  dark: false,
  bg: "#F1F2EF",
  panel: "#FFFFFF",
  panel2: "#F7F8F6",
  sunken: "#ECEDE9",
  ink: "#141517",
  ink2: "#4A4E55",
  ink3: "#80848C",
  ink4: "#B3B6BB",
  line: "#E3E4DF",
  line2: "#EDEEEA",
  brand: "#12A594",
  brandInk: "#0B7C6F",
  brandSoft: "#E3F4F1",
  onBrand: "#FFFFFF",
  ai: "#5B5BD6",
  aiSoft: "#EDEDFC",
  ok: "#19935A",
  okSoft: "#E3F4EA",
  warn: "#B7790B",
  warnSoft: "#FBF1DC",
  error: "#CF3B32",
  errorSoft: "#FBE7E5",
  primaryBg: "#141517",
  primaryFg: "#FFFFFF",
};

export const dark: Theme = {
  dark: true,
  bg: "#0E0F11",
  panel: "#17191C",
  panel2: "#1C1F22",
  sunken: "#212428",
  ink: "#F2F3F4",
  ink2: "#C3C7CD",
  ink3: "#8B9099",
  ink4: "#5E646D",
  line: "#272A2F",
  line2: "#212429",
  brand: "#2FBFAD",
  brandInk: "#79E0D2",
  brandSoft: "#13302E",
  onBrand: "#04221E",
  ai: "#8E8EF0",
  aiSoft: "#23234A",
  ok: "#46C58A",
  okSoft: "#12301F",
  warn: "#E0A33A",
  warnSoft: "#33270E",
  error: "#F0786D",
  errorSoft: "#3A1B18",
  primaryBg: "#F2F3F4",
  primaryFg: "#141517",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** The spacing and radii every screen uses, so they stay in step. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 11, lg: 14, pill: 999 };

/** A stable, pleasant colour for a person, from their address. */
export function personColor(email: string): string {
  let h = 0;
  for (const c of email.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 46%)`;
}
