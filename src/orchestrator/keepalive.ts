const ALARM_NAME = "wikibridge-keepalive";

function hasChromeAlarms(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof (chrome as any).alarms !== "undefined"
  );
}

export function startKeepalive(): void {
  if (!hasChromeAlarms()) return;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.4 }); // ~24s
}

export function stopKeepalive(): void {
  if (!hasChromeAlarms()) return;
  chrome.alarms.clear(ALARM_NAME);
}

// The background entry must call this on chrome.alarms.onAlarm so the SW
// service worker stays awake during long captures.
export function isKeepaliveAlarm(name: string): boolean {
  return name === ALARM_NAME;
}
