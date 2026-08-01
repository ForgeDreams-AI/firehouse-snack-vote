import React, { useState, useMemo } from "react";

/*  WhoOwes.jsx — PHX FD Kitty balances.
 *  Source: live Ledger cash + Venmo statement through 7/31. Week 9 ($180 due).
 *  Anthony (collector) is excluded. Withdrawn members keep the credit for what
 *  they already paid but are not counted as owing anything.                    */

const WEEK = 9;
const DUE = WEEK * 20;      // $180 owed-to-date to be caught up
const SEASON = 300;         // full-season dues

const MEMBERS = [
  { name: "Ryan flores", paid: 100, withdrawn: true },
  { name: "Colton Mendez", paid: 100 },
  { name: "Djevon Miles", paid: 100 },
  { name: "Frederick Miller", paid: 100 },
  { name: "Jeff Ohm", paid: 100 },
  { name: "Anthony Abruzzini", paid: 120 },
  { name: "Dylan Yeager", paid: 120 },
  { name: "Ivan Hernandez", paid: 120 },
  { name: "Jade Valdez", paid: 120 },
  { name: "Bailey Busby", paid: 140 },
  { name: "Branson Mitchell", paid: 140 },
  { name: "Conner Kitterman", paid: 140 },
  { name: "Devyn O’Brien", paid: 140 },
  { name: "DJ Olmstead", paid: 140 },
  { name: "Humberto Rodriguez", paid: 140 },
  { name: "Jack Shreiber", paid: 140 },
  { name: "Kyle Davis", paid: 140 },
  { name: "Mason Jones", paid: 140 },
  { name: "Micah Barnett", paid: 140 },
  { name: "Nicholas Tamborrino", paid: 140 },
  { name: "William (Garrett) Sayle", paid: 140 },
  { name: "Joshua salvatierra", paid: 160 },
  { name: "Alex Mendez", paid: 160 },
  { name: "Andrew  Dickerson", paid: 160 },
  { name: "Caleb Smyers", paid: 160 },
  { name: "Caswell Curry", paid: 160 },
  { name: "Curtis Johnson", paid: 160 },
  { name: "Dylan urquilla", paid: 160 },
  { name: "Isen Buntz", paid: 160 },
  { name: "Jacob Fretto", paid: 160 },
  { name: "Jacob Mulligan", paid: 160 },
  { name: "Jakob Hernandez", paid: 160 },
  { name: "Landon Gillespie", paid: 160 },
  { name: "Lawrence Nunez", paid: 160 },
  { name: "Ryan Giordano", paid: 160 },
  { name: "Tyler Maguire", paid: 160 },
  { name: "Adrian Centeno Ojeda", paid: 300 },
  { name: "Alexander Terrian", paid: 300 },
  { name: "Anthony Weidner", paid: 300 },
  { name: "Carson reilly", paid: 180 },
  { name: "Christopher phillips", paid: 320 },
  { name: "Damon Nguyen", paid: 300 },
  { name: "Ethan Buckhardt", paid: 180 },
  { name: "Justin sanchez", paid: 180 },
  { name: "Kendrick Pulce", paid: 180 },
  { name: "Megan Hedlund", paid: 300 },
  { name: "Parker Munier", paid: 200 },
  { name: "Parker Owens", paid: 180 },
  { name: "Pat brannan", paid: 300 },
  { name: "Rayce nichols", paid: 200 },
  { name: "Ricardo Garcia", paid: 200 },
  { name: "Ryan Johnson", paid: 180 },
  { name: "Vincent Leto", paid: 300 },
  { name: "William Kent Wickware II", paid: 280 },
];

const C = {
  red: "#C8102E", amber: "#FFB400", char: "#15171B", char2: "#1E2127",
  line: "#33373F", cream: "#F3EFE7", mut: "#8A909A", good: "#3DBE6B", bad: "#ff6b73",
};

const money = n => "$" + Number(n).toLocaleString();

export default function WhoOwes() {
  const [q, setQ] = useState("");
  const [hidePaid, setHidePaid] = useState(false);

  const stats = useMemo(() => {
    const active = MEMBERS.filter(m => !m.withdrawn);
    const owedOf = m => (m.withdrawn ? 0 : Math.max(0, DUE - m.paid));
    return {
      owedOf,
      totalOwed: active.reduce((s, m) => s + owedOf(m), 0),
      caughtUp: active.filter(m => owedOf(m) === 0).length,
      activeCount: active.length,
      collected: MEMBERS.reduce((s, m) => s + m.paid, 0),
    };
  }, []);

  const list = useMemo(() => MEMBERS.filter(m =>
    m.name.toLowerCase().includes(q.toLowerCase()) &&
    (!hidePaid || stats.owedOf(m) > 0)
  ), [q, hidePaid, stats]);

  const badge = m => {
    if (m.withdrawn) return { label: "Withdrawn — no longer owes", color: C.mut };
    if (m.paid >= SEASON) return { label: "Paid in full", color: C.good };
    const owe = stats.owedOf(m);
    if (owe === 0) return { label: m.paid > DUE ? "Ahead" : "Current", color: C.good };
    return { label: "Behind " + Math.round(owe / 20) + " wk", color: C.bad };
  };

  const wrap = { background: C.char, color: C.cream, fontFamily: "-apple-system,Segoe UI,Arial,sans-serif", minHeight: "100vh", padding: 16, boxSizing: "border-box" };
  const chip = { flex: 1, minWidth: 120, background: C.char2, border: "1px solid " + C.line, borderRadius: 10, padding: "10px 12px" };
  const th = { textAlign: "left", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: C.mut, padding: "8px 6px", borderBottom: "1px solid " + C.line };
  const td = { padding: "10px 6px", borderBottom: "1px solid " + C.line, fontSize: 14 };

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 18, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>🔥 PHX FD Kitty — Who Owes</h1>
      <div style={{ color: C.mut, fontSize: 13, margin: "4px 0 14px" }}>Week {WEEK} · {money(DUE)} due to date</div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={chip}><div style={{ fontSize: 10, color: C.mut, textTransform: "uppercase" }}>Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.bad }}>{money(stats.totalOwed)}</div></div>
        <div style={chip}><div style={{ fontSize: 10, color: C.mut, textTransform: "uppercase" }}>Caught up</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.good }}>{stats.caughtUp} / {stats.activeCount}</div></div>
        <div style={chip}><div style={{ fontSize: 10, color: C.mut, textTransform: "uppercase" }}>Collected</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(stats.collected)}</div></div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name…"
          style={{ flex: 1, minWidth: 180, padding: 10, borderRadius: 8, background: C.char2, color: C.cream, border: "1px solid " + C.line, fontSize: 14 }} />
        <button onClick={() => setHidePaid(v => !v)}
          style={{ padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
            background: hidePaid ? C.red : C.char2, color: C.cream, border: "1px solid " + (hidePaid ? C.red : C.line) }}>
          {hidePaid ? "Showing unpaid only" : "Only show who owes"}
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={th}>Name</th>
          <th style={{ ...th, textAlign: "right" }}>Paid</th>
          <th style={{ ...th, textAlign: "right" }}>Owes</th>
          <th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {list.map(m => {
            const b = badge(m), owe = stats.owedOf(m);
            return (
              <tr key={m.name} style={m.withdrawn ? { opacity: 0.55 } : undefined}>
                <td style={td}>{m.name}</td>
                <td style={{ ...td, textAlign: "right" }}>{money(m.paid)}</td>
                <td style={{ ...td, textAlign: "right", fontWeight: 700, color: owe ? C.bad : C.good }}>
                  {m.withdrawn ? "—" : money(owe)}
                </td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                  color: b.color, border: "1px solid " + b.color + "55", background: b.color + "18" }}>{b.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ color: C.mut, fontSize: 11, marginTop: 12 }}>
        Live Ledger cash + Venmo through 7/31. Withdrawn members keep credit for what they paid and are excluded from totals owed.
      </div>
    </div>
  );
}
