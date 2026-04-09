import type { ReactNode } from 'react'

type HelperToolId = 'steps' | 'assist' | 'review'

type HelperTool = {
  id: HelperToolId
  label: '步骤' | 'AI求助' | '下一步'
  ariaLabel: string
  className?: string
  onClick: () => void
  icon: ReactNode
}

const StepsIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M4 5.5h2.5M4 10h2.5M4 14.5h2.5M8.5 5.5H16M8.5 10H16M8.5 14.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const AssistIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M10 3.5l1.4 3.1 3.1 1.4-3.1 1.4L10 12.5 8.6 9.4 5.5 8l3.1-1.4L10 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M14.5 12.5l.8 1.8 1.7.7-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.7.8-1.8Z" fill="currentColor" />
  </svg>
)

const ReviewIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M5 4.5h10v11H5z" stroke="currentColor" strokeWidth="1.6" rx="2" />
    <path d="M7.5 8h5M7.5 11h5M7.5 14h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export function FocusLaunchHelperTools({
  onOpenSteps,
  onOpenAssist,
  onOpenReview,
}: FocusLaunchHelperToolsProps) {
  const tools: HelperTool[] = [
    {
      id: 'steps',
      label: '步骤',
      ariaLabel: '打开步骤编辑',
      onClick: onOpenSteps,
      icon: <StepsIcon />,
    },
    {
      id: 'assist',
      label: 'AI求助',
      ariaLabel: '打开 AI 求助',
      onClick: onOpenAssist,
      icon: <AssistIcon />,
    },
    {
      id: 'review',
      label: '下一步',
      ariaLabel: '打开下一步引导',
      className: 'focus-kickoff__helper-tool--review-ready',
      onClick: onOpenReview,
      icon: <ReviewIcon />,
    },
  ]

  return (
    <div className="focus-kickoff__footer-tools" aria-label="专注辅助工具">
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={
            tool.className
              ? `focus-kickoff__helper-tool ${tool.className}`
              : 'focus-kickoff__helper-tool'
          }
          aria-label={tool.ariaLabel}
          title={tool.label}
          onClick={tool.onClick}
        >
          <span className="focus-kickoff__helper-tool-icon">{tool.icon}</span>
          <span className="focus-kickoff__helper-tool-label">{tool.label}</span>
        </button>
      ))}
    </div>
  )
}

type FocusLaunchHelperToolsProps = {
  onOpenSteps: () => void
  onOpenAssist: () => void
  onOpenReview: () => void
}
