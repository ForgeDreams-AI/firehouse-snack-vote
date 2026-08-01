import React, { useState, useMemo } from "react";

/*  WhoOwes.jsx — PHX FD Kitty balances, Week 9 (dues so far: $180).
 *  Data current as of the July statement + last known cash. Anthony (collector)
 *  is excluded. Drop this component anywhere in a React app: <WhoOwes />        */

const WEEK = 9;
const DUE = WEEK * 20;          // $180 owed-to-date if fully caught up
const SEASON = 300;             // full-season dues

// name / paid-to-date / owed-through-this-week
const MEMBERS = [
  { name: "Andrew  Dickerson", paid: 60, owe: 120 },
  { name: "Colton Mendez", paid: 100, owe: 80 },
  { name: "Djevon Miles", paid: 100, owe: 80 },
  { name: "Frederick Miller", paid: 100, owe: 80 },
  { name: "Jeff Ohm", paid: 100, owe: 80 },
  { name: "Ryan flores", paid: 100, owe: 80 },
  { name: "Anthony Abruzzini", paid: 120, owe: 60 },
  { name: "Dylan Yeager", paid: 120, owe: 60 },
  { name: "Ivan Hernandez", paid: 120, owe: 60 },
  { name: "Jade Valdez", paid: 120, owe: 60 },
  { name: "Bailey Busby", paid: 140, owe: 40 },
  { name: "Branson Mitchell", paid: 140, owe: 40 },
  { name: "Conner Kitterman", paid: 140, owe: 40 },
  { name: "Devyn O’Brien", paid: 140, owe: 40 },
  { name: "DJ Olmstead", paid: 140, owe: 40 },
  { name: "Humberto Rodriguez", paid: 140, owe: 40 },
  { name: "Jack Shreiber", paid: 140, owe: 40 },
  { name: "Kyle Davis", paid: 140, owe: 40 },
  { name: "Mason Jones", paid: 140, owe: 40 },
  { name: "Micah Barnett", paid: 140, owe: 40 },
  { name: "Nicholas Tamborrino", paid: 140, owe: 40 },
  { name: "William (Garrett) Sayle", paid: 140, owe: 40 },
  { name: "Joshua salvatierra", paid: 150, owe: 30 },
  { name: "Alex Mendez", paid: 160, owe: 20 },
  { name: "Caleb Smyers", paid: 160, owe: 20 },
  { name: "Caswell Curry", paid: 160, owe: 20 },
  { name: "Curtis Johnson", paid: 160, owe: 20 },
  { name: "Dylan urquilla", paid: 160, owe: 20 },
  { name: "Isen Buntz", paid: 160, owe: 20 },
  { name: "Jacob Fretto", paid: 160, owe: 20 },
  { name: "Jacob Mulligan", paid: 160, owe: 20 },
  { name: "Jakob Hernandez", paid: 160, owe: 20 },
  { name: "Landon Gillespie", paid: 160, owe: 20 },
  { name: "Lawrence Nunez", paid: 160, owe: 20 },
  { name: "Ricardo Garcia", paid: 160, owe: 20 },
  { name: "Ryan Giordano", paid: 160, owe: 20 },
  { name: "Tyler Maguire", paid: 160, owe: 20 },
  { name: "Adrian Centeno Ojeda", paid: 300, owe: 0 },
  { name: "Alexander Terrian", paid: 300, owe: 0 },
  { name: "Anthony Weidner", paid: 300, owe: 0 },
  { name: "Carson reilly", paid: 180, owe: 0 },
  { name: "Christopher phillips", paid: 320, owe: 0 },
  { name: "Damon Nguyen", paid: 300, owe: 0 },
  { name: "Ethan Buckhardt", paid: 180, owe: 0 },
  { name: "Justin sanchez", paid: 180, owe: 0 },
  { name: "Kendrick Pulce", paid: 180, owe: 0 },
  { name: "Megan Hedlund", paid: 300, owe: 0 },
  { name: "Parker Munier", paid: 200, owe: 0 },
  { name: "Parker Owens", paid: 180, owe: 0 },
  { name: "Pat brannan", paid: 300, owe: 0 },
  { name: "Rayce nichols", paid: 200, owe: 0 },
  { name: "Ryan Johnson", paid: 180, owe: 0 },
  { name: "Vincent Leto", paid: 300, owe: 0 },
  { name: "William Kent Wickware II", paid: 260, owe: 0 },
];

const C = {
  red: "#C8102E", amber: "#FFB400", char: "#15171B", char2: "#1E2127",
  line: "#33373F", cream: "#F3EFE7", mut: "#8A909A", good: "#3DBE6B", bad: "#ff6b73",
};

export default function WhoOwes() {
  const [q, setQ] = useState("");

  const { list, totalOwed, caughtUp, collected } = useMemo(() => {
    const list = MEMBERS.filter(m => m.name.toLowerCase().includes(q.toLowerCase()));
    const totalOwed = MEMBERS.reduce((s, m) => s + m.owe, 0);
    const caughtUp = MEMBERS.filter(m => m.owe === 0).length;
    const collected = MEMBERS.reduce((s, m) => s + m.paid, 0);
    return { list, totalOwed, caughtUp, collected };
  }, [q]);

  const money = n => "$" + Number(n).toLocaleString();
  const status = m => {
    if (m.paid >= SEASON) return { label: "Paid in full", kind: "full" };
    if (m.owe === 0) return { label: m.paid > DUE ? "Ahead" : "Current", kind: "ok" };
    const wks = Math.round(m.owe / 20);
    return { label: "Behind " + wks + " wk" + (wks === 1 ? "" : "s"), kind: "late" };
  };

  const wrap = { background: C.char, color: C.cream, fontFamily: "-apple-system,Segoe UI,Arial,sans-serif", minHeight: "100vh", padding: 16, boxSizing: "border-box" };
  const bar = { background: C.char2, border: "1px solid " + C.line, borderRadius: 12, padding: 14, marginBottom: 12 };
  const chip = { flex: 1, minWidth: 120, background: C.char, border: "1px solid " + C.line, borderRadius: 10, padding: "10px 12px" };
  const th = { textAlign: "left", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: C.mut, padding: "8px 6px", borderBottom: "1px solid " + C.line };
  const td = { padding: "10px 6px", borderBottom: "1px solid " + C.line, fontSize: 14 };

  return (
    <div style={wrap}>
      <div style={bar}>
        <h1 style={{ fontSize: 18, letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>
          🔥 PHX FD Kitty — Who Owes
        </h1>
        <div style={{ color: C.mut, fontSize: 13, marginTop: 4 }}>Week {WEEK} · {money(DUE)} due to date</div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={chip}><div style={{ fontSize: 10, color: C.mut, textTransform: "uppercase" }}>Outstanding</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.bad }}>{money(totalOwed)}</div></div>
        <div style={chip}><div style={{ fontSize: 10, color: C.mut, textTransform: "uppercase" }}>Caught up</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.good }}>{caughtUp} / {MEMBERS.length}</div></div>
        <div style={chip}><div style={{ fontSize: 10, color: C.mut, textTransform: "uppercase" }}>Collected</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(collected)}</div></div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name…"
        style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, marginBottom: 12,
          background: C.char, color: C.cream, border: "1px solid " + C.line, fontSize: 14 }} />

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={th}>Name</th>
          <th style={{ ...th, textAlign: "right" }}>Paid</th>
          <th style={{ ...th, textAlign: "right" }}>Owes</th>
          <th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {list.map(m => {
            const s = status(m);
            const col = s.kind === "late" ? C.bad : s.kind === "full" ? C.good : C.good;
            return (
              <tr key={m.name}>
                <td style={td}>{m.name}</td>
                <td style={{ ...td, textAlign: "right" }}>{money(m.paid)}</td>
                <td style={{ ...td, textAlign: "right", color: m.owe ? C.bad : C.good, fontWeight: 700 }}>{money(m.owe)}</td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
                  color: col, border: "1px solid " + col + "55", background: col + "18" }}>{s.label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ color: C.mut, fontSize: 11, marginTop: 12 }}>
        Cash figures as of last statement; Venmo current through July 31. Excludes non-dues payments.
      </div>
    </div>
  );
}
