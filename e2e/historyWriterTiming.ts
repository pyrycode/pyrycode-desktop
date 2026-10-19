/** The native workload clock is renderer-local; runner observation never extends its deadline. */
export function writerWorkloadDuration(timing: {
  admittedAt: number | null
  completedAt: number | null
}): number {
  const { admittedAt, completedAt } = timing
  if (admittedAt === null || completedAt === null || !Number.isFinite(admittedAt) ||
    !Number.isFinite(completedAt) || admittedAt < 0 || completedAt < admittedAt) {
    throw new Error('native writer completion missing or invalid')
  }
  const duration = completedAt - admittedAt
  if (duration > 60000) throw new Error('native writer completion overdue: ' + duration + ' ms')
  return duration
}
