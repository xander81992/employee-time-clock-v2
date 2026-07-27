import Link from "next/link";

export default function HomePage() {
  return (
    <main className="home-page">
      <section className="home-card">
        <div className="brand-mark large">TC</div>
        <p className="eyebrow">EMPLOYEE ATTENDANCE</p>
        <h1>Employee Time Clock</h1>
        <p className="lead">
          Scan the stationary QR code to record Time In and Time Out, or open the administrator dashboard.
        </p>
        <div className="home-actions">
          <Link className="button primary" href="/kiosk">Open Employee Clock</Link>
          <Link className="button secondary" href="/admin/login">Administrator Login</Link>
        </div>
      </section>
    </main>
  );
}
