// web-vitals.ts
// Lightweight loader for Web Vitals metrics (LCP, CLS, INP) with logging and custom event support
import { onCLS, onLCP, onINP, Metric } from 'web-vitals';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

function sendToAnalytics(metric: Metric) {
  // Example: send to Google Analytics, Sentry, or your own endpoint
  // For now, just log to the console
  debugLog('[Web Vitals]', metric.name, metric.value, metric);
  // You can push to dataLayer or send via fetch/XHR here
}

export function initWebVitalsTracking(callback = sendToAnalytics) {
  onCLS(callback);
  onLCP(callback);
  onINP(callback);
}
