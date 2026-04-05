import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

class RootErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || '应用渲染失败',
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('RootErrorBoundary caught an error', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="loading-shell" role="alert">
        <div className="loading-card">
          <p className="eyebrow">Pomodoro Workbench</p>
          <h1>界面渲染失败</h1>
          <p>{this.state.message}</p>
          <button type="button" onClick={this.handleReload}>
            重新加载
          </button>
        </div>
      </div>
    )
  }
}

export default RootErrorBoundary
