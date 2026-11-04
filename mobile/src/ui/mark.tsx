// The Xooteq Mail mark: an envelope whose two diagonals make the X, with a dot
// for the new message. Drawn with views rather than an SVG, so the app carries
// no drawing library for one small shape.
import { View } from "react-native";
import { useTheme } from "@/lib/theme";

export function Mark({ size = 32, dot = true }: { size?: number; dot?: boolean }) {
  const t = useTheme();
  const u = size / 32;
  const stroke = Math.max(1.5, 2 * u);
  const boxW = 19 * u;
  const boxH = 14 * u;
  const diagonal = Math.sqrt(boxW * boxW + boxH * boxH);
  const angle = (Math.atan2(boxH, boxW) * 180) / Math.PI;
  const line = {
    position: "absolute" as const,
    width: diagonal - stroke * 2,
    height: stroke,
    borderRadius: stroke,
    backgroundColor: "#FFFFFF",
    top: boxH / 2 - stroke / 2,
    left: stroke,
  };
  return (
    <View style={{ width: size, height: size, borderRadius: 8 * u, backgroundColor: "#141517", alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: boxW, height: boxH, borderRadius: 2.5 * u, borderWidth: stroke, borderColor: "#FFFFFF" }}>
        <View style={[line, { transform: [{ rotate: `${angle}deg` }] }]} />
        <View style={[line, { transform: [{ rotate: `${-angle}deg` }] }]} />
      </View>
      {dot ? (
        <View style={{
          position: "absolute",
          top: 5 * u, right: 3.5 * u,
          width: 7 * u, height: 7 * u, borderRadius: 3.5 * u,
          backgroundColor: t.brand, borderWidth: 1.5 * u, borderColor: "#141517",
        }} />
      ) : null}
    </View>
  );
}
