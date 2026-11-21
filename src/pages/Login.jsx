import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, Mail, Sun } from "lucide-react";
import "./login.css";

const demoAccount = {
  email: "admin@bijliwala.in",
  password: "SolarDemo",
  name: "Arjun Mehta",
};

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");

  function signIn(event) {
    event.preventDefault();
    if (
      email.toLowerCase().trim() !== demoAccount.email ||
      password !== demoAccount.password
    ) {
      setError("Use the demo credentials shown below to enter this workspace.");
      return;
    }
    onLogin(demoAccount.name);
  }

  return (
    <main className="login-page">
      <div className="login-hero-copy">
        <h1>
          Powering a<br />
          <em>sustainable</em> tomorrow.
        </h1>
        <p>
          Manage enquiries, projects, inventory, and solar installations in one
          workspace.
        </p>
      </div>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <span>
            <Sun size={23} aria-hidden="true" />
          </span>
          Bijli Wala
        </div>
        <h2 id="login-title">Welcome back</h2>
        <p className="login-subtitle">
          Sign in to your solar operations workspace.
        </p>
        <form onSubmit={signIn}>
          <label htmlFor="login-email">Work email</label>
          <div className="login-input">
            <Mail size={18} aria-hidden="true" />
            <input
              required
              type="email"
              autoComplete="username"
              id="login-email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              placeholder="you@company.in"
            />
          </div>
          <label htmlFor="login-password">Password</label>
          <div className="login-input">
            <LockKeyhole size={18} aria-hidden="true" />
            <input
              required
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              id="login-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="Enter your password"
            />
            <button
              type="button"
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="login-submit" type="submit">
            Sign in
          </button>
        </form>
        <div className="login-divider">
          <span>Demo workspace</span>
        </div>
        <p className="login-credentials">
          Email <strong>{demoAccount.email}</strong>
          <br />
          Password <strong>{demoAccount.password}</strong>
        </p>
        <button
          type="button"
          className="login-demo"
          onClick={() => onLogin(demoAccount.name)}
        >
          Explore demo
        </button>
      </section>
    </main>
  );
}
