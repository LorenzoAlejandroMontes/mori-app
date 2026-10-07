-- Durable key-value settings (e.g. the AI provider config: key, model, endpoint).
-- Persists across app launches and WebView profiles, unlike browser localStorage.
CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
