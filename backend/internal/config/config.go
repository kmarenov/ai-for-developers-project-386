package config

import "os"

type Config struct {
	Port          string
	AllowedOrigin string
}

func Load() Config {
	return Config{
		Port:          envOrDefault("PORT", "8081"),
		AllowedOrigin: envOrDefault("CORS_ALLOWED_ORIGIN", "http://localhost:5173"),
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
