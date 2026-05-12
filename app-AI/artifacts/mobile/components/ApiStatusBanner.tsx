/**
 * A dismissible banner shown when the backend is unreachable or API_BASE is
 * misconfigured. Only appears on non-ok states; invisible when the server is up.
 */
import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { type ApiHealthResult } from "@/hooks/useApiHealth";

interface Props {
  health: ApiHealthResult;
}

export function ApiStatusBanner({ health }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (health.status === "ok" || health.status === "unknown") return null;
  if (dismissed && health.status !== "misconfigured") return null;

  const isMisconfig = health.status === "misconfigured";
  const isChecking  = health.status === "checking";

  return (
    <View style={[styles.banner, isMisconfig ? styles.bannerError : styles.bannerWarn]}>
      {isChecking ? (
        <ActivityIndicator size="small" color="#92400E" style={{ marginRight: 8 }} />
      ) : (
        <Feather
          name={isMisconfig ? "alert-octagon" : "wifi-off"}
          size={14}
          color={isMisconfig ? "#991B1B" : "#92400E"}
          style={{ marginRight: 8 }}
        />
      )}

      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: isMisconfig ? "#991B1B" : "#78350F" }]}>
          {isMisconfig
            ? "API not configured"
            : isChecking
            ? "Checking server connection…"
            : "Server unreachable"}
        </Text>
        {health.reason && (
          <Text style={[styles.reason, { color: isMisconfig ? "#B91C1C" : "#92400E" }]} numberOfLines={2}>
            {health.reason}
          </Text>
        )}
      </View>

      {!isMisconfig && !isChecking && (
        <TouchableOpacity onPress={health.recheck} style={styles.retryBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="refresh-cw" size={14} color="#92400E" />
        </TouchableOpacity>
      )}

      {!isMisconfig && (
        <TouchableOpacity onPress={() => setDismissed(true)} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={14} color="#92400E" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection:  "row",
    alignItems:     "flex-start",
    paddingHorizontal: 14,
    paddingVertical:   10,
    borderBottomWidth: 1,
  },
  bannerWarn: {
    backgroundColor: "#FFFBEB",
    borderBottomColor: "#FCD34D",
  },
  bannerError: {
    backgroundColor: "#FEF2F2",
    borderBottomColor: "#FCA5A5",
  },
  title: {
    fontSize:   13,
    fontWeight: "600",
  },
  reason: {
    fontSize:  12,
    marginTop:  2,
  },
  retryBtn: {
    marginLeft: 8,
    padding:    2,
  },
  closeBtn: {
    marginLeft: 6,
    padding:    2,
  },
});
