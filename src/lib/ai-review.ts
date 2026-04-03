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

  const scopeTodos = snapshot.todos.filter((todo) => (projectId ? todo.projectId === projectId : true))
  if (!scopeTodos.length) {
    return {
      canGenerate: false,
      reason: '当前范围内还没有可复盘的任务数据',
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
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - 7)

  return sessions.filter((session) => {
    if (session.type !== 'focus' || session.result !== 'completed') {
      return false
    }
    if (projectId && session.projectId !== projectId) {
      return false
    }
    const startedAt = new Date(session.startedAt)
    return !Number.isNaN(startedAt.getTime()) && startedAt >= windowStart
  })
}
