import type {
  AiReviewRecord,
  AiReviewScope,
  AiReviewTimeframe,
  AppSnapshot,
  FocusSession,
} from '../types'

export const AI_REVIEW_MINIMUM_FOCUS_SESSIONS = 5
export const AI_REVIEW_TIMEFRAME: AiReviewTimeframe = 'last_7_days'

export function getAiReviewEligibility(
  snapshot: AppSnapshot,
  projectId: string | null,
  now = new Date(),
): { canGenerate: boolean; reason: string | null; focusCount: number } {
  const scopeSessions = filterRecentCompletedFocusSessions(snapshot.sessions, projectId, now)
  if (scopeSessions.length < AI_REVIEW_MINIMUM_FOCUS_SESSIONS) {
    return {
      canGenerate: false,
      reason: `近 7 天至少完成 ${AI_REVIEW_MINIMUM_FOCUS_SESSIONS} 次专注后才能生成 AI 复盘`,
      focusCount: scopeSessions.length,
    }
  }

  return {
    canGenerate: true,
    reason: null,
    focusCount: scopeSessions.length,
  }
}

export function formatAiReviewScopeLabel(review: {
  scope: AiReviewScope
  projectName: string | null
}): string {
  if (review.scope === 'project') {
    return review.projectName ? `项目：${review.projectName}` : '单项目'
  }
  return '全部项目'
}

export function formatAiReviewTimeframeLabel(timeframe: AiReviewTimeframe): string {
  switch (timeframe) {
    case 'last_7_days':
      return '近 7 天'
  }
}

export function buildAiReviewDraftTitle(projectName: string | null): string {
  return projectName ? `AI 复盘 · ${projectName}` : 'AI 复盘 · 全部项目'
}

export function sortAiReviews(records: AiReviewRecord[]): AiReviewRecord[] {
  return [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function filterRecentCompletedFocusSessions(
  sessions: FocusSession[],
  projectId: string | null,
  now: Date,
): FocusSession[] {
  const windowEnd = endOfLocalDay(now)
  const windowStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))

  return sessions.filter((session) => {
    if (session.type !== 'focus' || session.result !== 'completed') {
      return false
    }
    if (projectId && session.projectId !== projectId) {
      return false
    }

    const completedAt = getCompletedAt(session)
    return completedAt !== null && completedAt >= windowStart && completedAt <= windowEnd
  })
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
}

function endOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999)
}

function getCompletedAt(session: FocusSession): Date | null {
  if (session.endedAt !== null) {
    const endedAt = new Date(session.endedAt)
    if (!Number.isNaN(endedAt.getTime())) {
      return endedAt
    }
  }

  const startedAt = new Date(session.startedAt)
  if (!Number.isNaN(startedAt.getTime())) {
    return startedAt
  }

  return null
}
