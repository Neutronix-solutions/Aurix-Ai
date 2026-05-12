import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Height of the icon+label row inside the tab bar (fixed). */
export const TAB_ICON_AREA = 50;

/**
 * Returns the total tab bar height — icon area plus the device's bottom
 * safe-area inset (home indicator on iOS, gesture bar on Android).
 *
 * Use this as `paddingBottom` on scrollable content inside tab screens so
 * the last item is never hidden behind the floating tab bar.
 */
export function useTabBarHeight(): number {
  const { bottom } = useSafeAreaInsets();
  return TAB_ICON_AREA + bottom;
}

/**
 * Returns `paddingBottom` value that clears the floating tab bar with an
 * extra 16px of visual breathing room.
 */
export function useTabBarPadding(): number {
  return useTabBarHeight() + 16;
}
