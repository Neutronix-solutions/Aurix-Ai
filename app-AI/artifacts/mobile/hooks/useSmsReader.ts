/**
 * useSmsReader — Android SMS reading hook
 *
 * In EAS Build (production APK/AAB): reads SMS natively via react-native-get-sms-android
 * In Expo Go / web: gracefully returns [] and shows clipboard fallback
 *
 * Requires:
 *  - android.permission.READ_SMS in app.json (already added)
 *  - react-native-get-sms-android installed (already in package.json)
 */

import { useCallback, useState } from "react";
import { Platform, PermissionsAndroid, Alert } from "react-native";

export interface RawSms {
  _id:     string;
  address: string;   // sender (bank number)
  body:    string;   // SMS content
  date:    string;   // timestamp ms
  type:    string;   // 1 = inbox
}

export interface UseSmsReaderResult {
  readSms:      (options?: ReadSmsOptions) => Promise<RawSms[]>;
  hasPermission: boolean | null;
  requestPermission: () => Promise<boolean>;
  isReading:    boolean;
}

export interface ReadSmsOptions {
  maxCount?: number;    // default 100
  minDate?:  number;    // Unix ms — default last 24h
  filter?:   "bank" | "all"; // default "bank"
}

// Qatar / GCC bank sender numbers / patterns
const BANK_SENDERS = [
  "QNB", "CBQ", "QIIB", "DOHABANK", "MASRAF", "RAYAN",
  "KHALIJI", "AHLIBANK", "QIB", "HSBC", "STANCHART",
  "BANKQATAR", "2252", "4770", "MBSMS", "BANKIQ",
];

function isBankSender(address: string): boolean {
  const upper = address.toUpperCase();
  return BANK_SENDERS.some(b => upper.includes(b));
}

function isBankContent(body: string): boolean {
  return /debit|credit|charged|QAR|خصم|حساب|رصيد|بطاقة/i.test(body);
}

let SmsAndroid: any = null;
try {
  // Dynamic require — only loads on Android native builds
  // Falls back gracefully on Expo Go / web
  SmsAndroid = require("react-native-get-sms-android").default;
} catch { /* not available on this platform */ }

export function useSmsReader(): UseSmsReaderResult {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isReading, setIsReading]         = useState(false);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== "android") {
      setHasPermission(false);
      return false;
    }
    if (!SmsAndroid) {
      setHasPermission(false);
      return false;
    }
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        {
          title:   "Allow Aurix AI to read SMS",
          message: "Aurix AI reads your bank SMS to automatically track expenses. Only bank transaction messages are processed. Your data never leaves your device raw.",
          buttonNeutral:  "Ask Me Later",
          buttonNegative: "No Thanks",
          buttonPositive: "Allow",
        },
      );
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      setHasPermission(granted);
      return granted;
    } catch {
      setHasPermission(false);
      return false;
    }
  }, []);

  const readSms = useCallback(async (opts: ReadSmsOptions = {}): Promise<RawSms[]> => {
    if (Platform.OS !== "android" || !SmsAndroid) return [];

    const { maxCount = 100, minDate, filter = "bank" } = opts;
    const since = minDate ?? (Date.now() - 24 * 60 * 60 * 1000); // default last 24h

    // Check/request permission
    const check = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (!check) {
      const granted = await requestPermission();
      if (!granted) return [];
    }
    setHasPermission(true);

    setIsReading(true);
    try {
      const smsMessages = await new Promise<RawSms[]>((resolve, reject) => {
        SmsAndroid.list(
          JSON.stringify({
            box:      "inbox",
            minDate:  since,
            maxCount,
            read:     undefined, // 0 = unread, 1 = read, undefined = all
          }),
          (err: string) => reject(new Error(err)),
          (_count: number, smsList: string) => {
            try { resolve(JSON.parse(smsList) as RawSms[]); }
            catch { resolve([]); }
          },
        );
      });

      if (filter === "bank") {
        return smsMessages.filter(
          sms => isBankSender(sms.address) || isBankContent(sms.body)
        );
      }
      return smsMessages;
    } catch {
      return [];
    } finally {
      setIsReading(false);
    }
  }, [requestPermission]);

  return { readSms, hasPermission, requestPermission, isReading };
}
