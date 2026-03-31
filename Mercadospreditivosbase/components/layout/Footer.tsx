export default function Footer() {
  return (
    <footer
      className="mt-auto"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div
        className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between text-xs"
        style={{ color: "var(--muted)", fontFamily: "monospace" }}
      >
        <span>Built on Base</span>
        <span>v0.1.0</span>
      </div>
    </footer>
  );
}
