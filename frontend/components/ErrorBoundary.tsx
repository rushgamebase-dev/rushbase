"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div
          className="flex items-center justify-center p-4 rounded-lg"
          style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)" }}
        >
          <span className="text-xs font-mono" style={{ color: "#ff4444" }}>
            Something went wrong. Refresh to retry.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
