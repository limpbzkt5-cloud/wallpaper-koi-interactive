import type { WeatherPresetId } from "./weather";

export type DayNightMode = "realtime" | "15m" | "30m" | "60m" | "static";

export function computeDayNightWeather(
  mode: DayNightMode,
  simulationTime: number,
  fallbackWeather: WeatherPresetId = "sunny",
): WeatherPresetId {
  if (mode === "static") {
    return fallbackWeather;
  }

  if (mode === "realtime") {
    const now = new Date();
    const decimalHours =
      now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

    // 05:00 to 07:30 - Dawn / Morning Mist
    if (decimalHours >= 5.0 && decimalHours < 7.5) {
      return "mist";
    }
    // 07:30 to 12:00 - Clear morning pond
    if (decimalHours >= 7.5 && decimalHours < 12.0) {
      return "deep-clear";
    }
    // 12:00 to 16:30 - Full bright sunny day
    if (decimalHours >= 12.0 && decimalHours < 16.5) {
      return "sunny";
    }
    // 16:30 to 18:45 - Sunset / Golden Hour
    if (decimalHours >= 16.5 && decimalHours < 18.75) {
      return "sunset";
    }
    // 18:45 to 05:00 - Moonlight Night
    return "moonlight";
  }

  // Accelerated cycle modes
  let cycleSeconds = 1800; // default 30 mins
  if (mode === "15m") cycleSeconds = 900;
  else if (mode === "60m") cycleSeconds = 3600;

  const phase = (simulationTime % cycleSeconds) / cycleSeconds; // [0, 1)

  if (phase < 0.15) {
    return "mist"; // Dawn
  } else if (phase < 0.45) {
    return "sunny"; // Day
  } else if (phase < 0.60) {
    return "deep-clear"; // Afternoon
  } else if (phase < 0.75) {
    return "sunset"; // Sunset
  } else {
    return "moonlight"; // Night
  }
}
