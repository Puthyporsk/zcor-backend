// utils/timeMath.js

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:mm

export function timeToMinutes(hhmm) {
  if (typeof hhmm !== "string" || !TIME_REGEX.test(hhmm)) {
    throw new Error("Invalid time format (expected HH:mm)");
  }
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return h * 60 + m;
}

export function computeManualTotals(
  { startTime, endTime, breakMinutes = 0 },
  { roundingMinutes = 0, roundingMode = "nearest" } = {}
) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  if (end <= start) {
    // Keep it simple: no overnight shifts in a single entry
    throw new Error("endTime must be after startTime");
  }

  const totalMinutes = end - start;
  const breakMins = Math.max(0, Number(breakMinutes || 0));

  if (breakMins > totalMinutes) {
    throw new Error("breakMinutes cannot exceed total shift minutes");
  }

  const paidMinutes = Math.max(0, totalMinutes - breakMins);
  const paidMinutesRounded = roundMinutes(paidMinutes, roundingMinutes, roundingMode);

  return { totalMinutes, breakMinutes: breakMins, paidMinutes, paidMinutesRounded };
}

export function roundMinutes(minutes, increment, mode = "nearest") {
  const inc = Number(increment || 0);
  if (!inc || inc <= 0) return minutes;

  const x = minutes / inc;
  if (mode === "up") return Math.ceil(x) * inc;
  if (mode === "down") return Math.floor(x) * inc;
  return Math.round(x) * inc;
}
