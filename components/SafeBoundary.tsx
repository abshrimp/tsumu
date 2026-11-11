"use client";

import { Component, type ReactNode } from "react";
import { tr } from "../lib/i18n";

/**
 * 中で表示エラーが起きても、エディタ全体を落とさずにこの部分だけ案内に差し替える。
 * エラーの中身は画面に出さず、コンソールにだけ残す
 */
export default class SafeBoundary extends Component<
  {
    children: ReactNode;
    /** 案内の見出し（例: 「スクリプト画面」） */
    label?: string;
    /** 閉じられる画面なら閉じるボタンを出す */
    onClose?: () => void;
    /** 中身が変わったら表示し直す（ページ切替など） */
    resetKey?: unknown;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="safe-fallback" role="alert">
        <p>
          {this.props.label
            ? tr("Couldn't display {label}. Your work has been saved.", { label: this.props.label })
            : tr("Couldn't display this part. Your work has been saved.")}
        </p>
        <div className="safe-fallback-actions">
          <button className="btn btn-sm" onClick={() => this.setState({ failed: false })}>
            {tr("Try again")}
          </button>
          {this.props.onClose && (
            <button className="btn btn-sm" onClick={this.props.onClose}>
              {tr("Close")}
            </button>
          )}
        </div>
      </div>
    );
  }
}
