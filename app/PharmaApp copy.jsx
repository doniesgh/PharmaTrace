"use client";
import { useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { QRCodeSVG } from "qrcode.react";
import { REGISTRY_ADDRESS, TRACKING_ADDRESS, REGISTRY_ABI, TRACKING_ABI, ROLES, STATUSES } from "../lib/contracts";

const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const fmt = (ts) => new Date(Number(ts) * 1000).toLocaleString("fr-FR");
const fmtDay = (ts) => new Date(Number(ts) * 1000).toLocaleDateString("fr-FR");
const ZERO = "0x0000000000000000000000000000000000000000";
const LAST = STATUSES.length - 1; // dernier statut = "Reçu confirmé"

// Répartition du prix : 80 % pharmacie, le reste (20 %) livreur — identique au contrat
const split = (price) => {
  const pharmacy = (price * 80n) / 100n;
  return [pharmacy, price - pharmacy];
};
const eth = (wei) => formatEther(wei) + " ETH";

function Logo({ w = 44 }) {
  return (
    <svg width={w} height={w * 0.6} viewBox="0 0 160 96" fill="none" stroke="#8CC8C8" strokeWidth="10" aria-hidden="true">
      <rect x="5" y="14" width="90" height="68" rx="34" />
      <rect x="65" y="14" width="90" height="68" rx="34" />
    </svg>
  );
}

function Journey({ status }) {
  return (
    <ol className="journey" aria-label="Étapes du parcours">
      {STATUSES.map((s, i) => (
        <li key={s} className={i < status || status === LAST ? "done" : i === status ? "now" : ""}>
          <i />{s}
        </li>
      ))}
    </ol>
  );
}

export default function PharmaApp() {
  const [c, setC] = useState(null);            // { me, reg, trk, provider }
  const [user, setUser] = useState(null);      // { role, name }
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState([]);
  const [earn, setEarn] = useState(0n);        // gains retirables (pharmacie / livreur)
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("espace");
  const [trackId, setTrackId] = useState(null);
  const [inst, setInst] = useState(null);
  const [created, setCreated] = useState(null);
  const [menu, setMenu] = useState(false);     // menu latéral sur mobile

  const notify = (type, text) => { setToast({ type, text }); setTimeout(() => setToast(null), 5000); };

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setInst(e); };
    window.addEventListener("beforeinstallprompt", h);
    window.ethereum?.on?.("accountsChanged", () => location.reload());
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  useEffect(() => { setTrackId(new URLSearchParams(location.search).get("id")); }, []);
  useEffect(() => { if (trackId) setTab("suivi"); }, [trackId]);
  useEffect(() => { setMenu(false); }, [tab]);

  async function load(reg, trk, me) {
    const [role, name] = await reg.getUser(me);
    setUser({ role: Number(role), name });
    const n = Number(await reg.medicineCount());
    const list = [];
    for (let id = 1; id <= n; id++) {
      const [mn, batch, exp, pharmacy, price] = await reg.getMedicine(id);
      const [st, client, courier, reported, paid] = await trk.getTracking(id);
      list.push({ id, name: mn, batch, expiry: Number(exp), pharmacy, price, status: Number(st), client, courier, reported, paid });
    }
    setItems(list.reverse());
    setEarn(await trk.balances(me));
    const ev = await reg.queryFilter(reg.filters.UserRegistered());
    setPeople(ev.map((e) => ({ address: e.args.user, role: Number(e.args.role), name: e.args.name })));
  }

  async function connect() {
    if (!window.ethereum) return notify("err", "MetaMask est introuvable.");
    try {
      // 1. Put MetaMask on Ganache (chain 1337 = 0x539) BEFORE creating the provider
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x539" }] });
      } catch (err) {
        if (err.code === 4902 || err.code === -32603) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x539",
              chainName: "Ganache",
              rpcUrls: ["http://127.0.0.1:7545"],
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            }],
          });
        } else throw err;
      }

      // 2. Provider, contrats, chargement
      const provider = new BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      const block = await provider.getBlockNumber();
      const code = await provider.getCode(REGISTRY_ADDRESS);
      if (code === "0x") {
        return notify("err",
          `Aucun contrat à ${short(REGISTRY_ADDRESS)} sur ce réseau (chain ${net.chainId}, bloc ${block}). ` +
          `Dans Ganache, "Current block" doit être ${block}.`);
      }
      const signer = await provider.getSigner();
      const me = await signer.getAddress();
      const reg = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
      const trk = new Contract(TRACKING_ADDRESS, TRACKING_ABI, signer);
      setC({ me, reg, trk, provider });
      await load(reg, trk, me);
    } catch (e) {
      console.error(e);
      notify("err", "Connexion impossible : " + (e.shortMessage || e.message));
    }
  }

  async function logout() {
    try {
      // Removes this site's access to MetaMask, so the next connect asks which account to use
      await window.ethereum.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch (e) {
      console.warn("Revoke not supported:", e);
    }
    setC(null);
    setUser(null);
    setItems([]);
    setPeople([]);
    setEarn(0n);
    setTab("espace");
    setCreated(null);
    setMenu(false);
    notify("ok", "Déconnecté. Reconnectez-vous avec un autre compte.");
  }

  async function run(label, fn, after) {
    setBusy(true);
    try {
      const tx = await fn();
      await tx.wait();
      await load(c.reg, c.trk, c.me);
      if (after) await after();
      notify("ok", label);
    } catch (e) {
      notify("err", e.reason || e.info?.error?.message || e.shortMessage || e.message);
    }
    setBusy(false);
  }

  const who = (a) => people.find((p) => p.address.toLowerCase() === a.toLowerCase())?.name || short(a);
  const openTrack = (id) => { setTrackId(String(id)); setTab("suivi"); };

  /* ---------- Landing ---------- */
  if (!c || !user)
    return (
      <>
        <main className="hero">
          <Logo w={92} />
          <h1>PharmaTrace</h1>
          <p>Commandez, suivez et recevez chaque médicament, de la pharmacie jusqu'à votre porte.</p>
          <Journey status={1} />
          <div><button className="btn light" onClick={connect}>Connecter MetaMask</button></div>
        </main>
        {toast && <div className={"toast " + (toast.type === "err" ? "err" : "")} role="status">{toast.text}</div>}
      </>
    );

  const me = c.me.toLowerCase();
  const mine = items.filter((m) =>
    user.role === 1 ? m.pharmacy.toLowerCase() === me
      : user.role === 2 ? m.courier.toLowerCase() === me
        : user.role === 3 ? m.client.toLowerCase() === me : false);

  const titles = {
    1: ["Mes médicaments", "Enregistrez un médicament avec son prix, puis envoyez-le au livreur quand un client le commande. Vous recevez 80 % du prix."],
    2: ["Mes livraisons", "Les médicaments qu'une pharmacie vous a confiés. Vous recevez 20 % du prix à la confirmation de réception."],
    3: ["Mes commandes", "Commandez dans le catalogue ci-dessous, puis confirmez la réception pour libérer le paiement."]
  };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><Logo w={34} /><b>PharmaTrace</b></div>
        <button className="burger" onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu}>
          <span /><span /><span />
        </button>
      </header>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}

      <aside className={"side" + (menu ? " open" : "")}>
        <div className="brand"><Logo /><b>PharmaTrace</b></div>
        <div className="me"><strong>{user.role ? user.name : "Nouveau compte"}</strong><span>{ROLES[user.role] || "Rôle à choisir"} · {short(c.me)}</span></div>
        <Wallet c={c} refresh={items} notify={notify} role={user.role} earn={earn} busy={busy}
          onWithdraw={() => run("Gains retirés", () => c.trk.withdraw())} />
        {user.role > 0 && (
          <nav className="nav">
            <button aria-current={tab === "espace"} onClick={() => setTab("espace")}>Mon espace</button>
            <button aria-current={tab === "suivi"} onClick={() => setTab("suivi")}>Suivre un médicament</button>
            <button aria-current={tab === "annuaire"} onClick={() => setTab("annuaire")}>Annuaire</button>
          </nav>
        )}
        <div className="side-bottom">
          {inst && <button className="btn light" onClick={() => inst.prompt()}>Installer l'application</button>}
          <button className="btn out" onClick={logout}>Se déconnecter</button>
        </div>
      </aside>

      <main className="main">
        {/* ---------- Create account ---------- */}
        {user.role === 0 && <Register busy={busy} onSubmit={(role, name) => run("Compte créé", () => c.reg.register(role, name))} />}

        {/* ---------- My space ---------- */}
        {user.role > 0 && tab === "espace" && (
          <>
            <h2>{titles[user.role][0]}</h2>
            <p className="sub">{titles[user.role][1]}</p>

            {user.role === 1 && (
              <form className="panel" onSubmit={(e) => {
                e.preventDefault();
                const form = e.target;
                const f = Object.fromEntries(new FormData(form));
                const ts = Math.floor(new Date(f.expiry).getTime() / 1000);
                run("Médicament enregistré", () => c.reg.registerMedicine(f.name, f.batch, ts, parseEther(String(f.price))),
                  async () => setCreated(Number(await c.reg.medicineCount())));
                form.reset();
              }}>
                <h3>Enregistrer un médicament</h3>
                <div className="row-form">
                  <label className="field">Nom<input name="name" required placeholder="Doliprane 1000 mg" /></label>
                  <label className="field">Numéro de lot<input name="batch" required placeholder="LOT-2026-001" /></label>
                  <label className="field">Date de péremption<input name="expiry" type="date" required /></label>
                  <label className="field">Prix (ETH)<input name="price" type="number" step="any" min="0" required placeholder="0.01" /></label>
                  <button className="btn" disabled={busy}>Enregistrer</button>
                </div>
                {created && (
                  <p style={{ marginTop: 14 }}>
                    Médicament n°{created} enregistré. <button type="button" className="btn ghost" onClick={() => openTrack(created)}>Voir son code QR</button>
                  </p>
                )}
              </form>
            )}

            <section className="panel">
              {mine.length === 0 && <p className="empty">
                {user.role === 1 ? "Aucun médicament pour l'instant. Utilisez le formulaire ci-dessus."
                  : user.role === 2 ? "Aucune livraison pour l'instant. Elles apparaîtront ici dès qu'une pharmacie vous les remet."
                    : "Aucune commande pour l'instant. Choisissez un médicament dans le catalogue."}</p>}
              {mine.map((m) => (
                <Row key={m.id} m={m} role={user.role} people={people} who={who} busy={busy} run={run} c={c}
                  open={() => openTrack(m.id)} />
              ))}
              <Catalog items={items} who={who} open={openTrack} role={user.role} busy={busy} run={run} c={c} />
            </section>
          </>
        )}

        {/* ---------- Tracking ---------- */}
        {user.role > 0 && tab === "suivi" && (
          <>
            <h2>Suivre un médicament</h2>
            <p className="sub">Entrez son numéro, ou scannez son code QR.</p>
            <form className="panel row-form" onSubmit={(e) => { e.preventDefault(); setTrackId(new FormData(e.target).get("id")); }}>
              <label className="field">Numéro du médicament<input name="id" type="number" min="1" defaultValue={trackId || ""} required /></label>
              <button className="btn">Rechercher</button>
            </form>
            {trackId && <Track c={c} id={trackId} who={who} items={items} />}
          </>
        )}
        {user.role > 0 && tab === "annuaire" && <Directory people={people} me={c.me} provider={c.provider} notify={notify} />}
      </main>
      {toast && <div className={"toast " + (toast.type === "err" ? "err" : "")} role="status">{toast.text}</div>}
    </div>
  );
}

function Catalog({ items, who, open, role, busy, run, c }) {
  const [q, setQ] = useState("");
  const list = items.filter((m) => (m.name + m.batch + m.id).toLowerCase().includes(q.toLowerCase()));
  const nb = (s) => items.filter((m) => m.status === s).length;

  return (
    <>
      <h2 style={{ marginTop: 8 }}>Tous les médicaments</h2>
      <p className="sub">Le catalogue public enregistré sur la blockchain.</p>

      <div className="stats">
        <div><b>{items.length}</b><span>Enregistrés</span></div>
        <div><b>{nb(1)}</b><span>Commandés</span></div>
        <div><b>{nb(2)}</b><span>En livraison</span></div>
        <div><b>{nb(3) + nb(4)}</b><span>Livrés</span></div>
        <div><b>{items.filter((m) => m.reported).length}</b><span>Signalés</span></div>
      </div>

      <div className="panel">
        <label className="field">Recherche
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, lot ou numéro" />
        </label>
        <div style={{ overflowX: "auto" }}>
          <table className="dir">
            <thead>
              <tr><th>N°</th><th>Médicament</th><th>Lot</th><th>Péremption</th><th>Prix</th><th>Pharmacie</th><th>Statut</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const expired = m.expiry * 1000 < Date.now();
                const canOrder = role === 3 && m.status === 0 && !expired;
                return (
                  <tr key={m.id}>
                    <td data-label="N°">{m.id}</td>
                    <td data-label="Médicament">{m.name}</td>
                    <td data-label="Lot">{m.batch}</td>
                    <td data-label="Péremption"><span>{fmtDay(m.expiry)} {expired && <span className="chip bad">Périmé</span>}</span></td>
                    <td data-label="Prix">{eth(m.price)}</td>
                    <td data-label="Pharmacie">{who(m.pharmacy)}</td>
                    <td data-label="Statut">
                      <span>
                        <span className={"chip s" + m.status}>{STATUSES[m.status]}</span>
                        {m.reported && <span className="chip warn" style={{ marginLeft: 6 }}>Signalé</span>}
                      </span>
                    </td>
                    <td className="cell-actions">
                      {canOrder && (
                        <button className="btn" disabled={busy}
                          onClick={() => run("Commande envoyée, paiement bloqué jusqu'à la réception", () => c.trk.order(m.id, { value: m.price }))}>
                          Commander
                        </button>
                      )}
                      <button className="btn ghost" onClick={() => open(m.id)}>Suivre</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="empty">Aucun médicament pour l'instant.</p>}
      </div>
    </>
  );
}

function Wallet({ c, refresh, notify, role, earn, busy, onWithdraw }) {
  const [bal, setBal] = useState(null);

  // Recharge le solde au début, puis après chaque transaction (la liste "items" change)
  useEffect(() => {
    c.provider.getBalance(c.me).then((b) => setBal(formatEther(b))).catch(() => setBal(null));
  }, [c, refresh]);

  async function copy() {
    try { await navigator.clipboard.writeText(c.me); notify("ok", "Adresse copiée"); }
    catch { notify("err", "Copie impossible"); }
  }

  return (
    <div className="wallet">
      <small>Portefeuille</small>
      <code>{c.me.slice(0, 10)}…{c.me.slice(-8)}</code>
      <div className="wallet-row">
        <b>{bal === null ? "…" : Number(bal).toFixed(4)} ETH</b>
        <button className="copy" onClick={copy} aria-label="Copier l'adresse">Copier</button>
      </div>
      {(role === 1 || role === 2) && (
        <div className="wallet-row" style={{ marginTop: 8 }}>
          <small>Gains : <b>{Number(formatEther(earn)).toFixed(4)} ETH</b></small>
          <button className="copy" disabled={busy || earn === 0n} onClick={onWithdraw}>Retirer</button>
        </div>
      )}
    </div>
  );
}

function Register({ onSubmit, busy }) {
  const [role, setRole] = useState(1);
  const opts = [[1, "Pharmacie", "Enregistre les médicaments et les envoie"], [2, "Livreur", "Livre les médicaments"], [3, "Client", "Commande, reçoit et confirme"]];
  return (
    <>
      <h2>Créer votre compte</h2>
      <p className="sub">Choisissez votre rôle. Il est définitif pour cette adresse.</p>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); onSubmit(role, new FormData(e.target).get("name").trim()); }}>
        <div className="roles">
          {opts.map(([v, t, d]) => (
            <label key={v}><input type="radio" name="role" checked={role === v} onChange={() => setRole(v)} /><b>{t}</b><small>{d}</small></label>
          ))}
        </div>
        <div className="row-form">
          <label className="field">Votre nom<input name="name" required placeholder="Pharmacie Centrale" /></label>
          <button className="btn" disabled={busy}>Créer mon compte</button>
        </div>
      </form>
    </>
  );
}

function Row({ m, role, people, who, busy, run, c, open }) {
  const [rep, setRep] = useState(false);
  const [details, setDetails] = useState("");
  const [co, setCo] = useState("");
  const expired = m.expiry * 1000 < Date.now();
  const couriers = people.filter((p) => p.role === 2);
  const [phShare, coShare] = split(m.price);
  return (
    <article className="med">
      <div className="med-head">
        <div>
          <h4>{m.name} <small>n°{m.id} · lot {m.batch} · péremption {fmtDay(m.expiry)} · prix {eth(m.price)}</small></h4>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {expired && <span className="chip bad">Périmé</span>}
          {m.reported && <span className="chip warn">Signalé</span>}
          <span className={"chip s" + m.status}>{STATUSES[m.status]}</span>
        </div>
      </div>
      <Journey status={m.status} />
      {role === 1 && <small>Votre part : {eth(phShare)} (80 %)</small>}
      {role === 2 && <small>Votre part : {eth(coShare)} (20 %)</small>}
      <div className="actions">
        {role === 1 && m.status === 0 && <small>En attente d'une commande d'un client.</small>}
        {role === 1 && m.status === 1 && (
          <>
            <small>Commandé par {who(m.client)}</small>
            <label className="field">Livreur
              <select value={co} onChange={(e) => setCo(e.target.value)}><option value="">Choisir…</option>
                {couriers.map((p) => <option key={p.address} value={p.address}>{p.name} ({short(p.address)})</option>)}
              </select></label>
            <button className="btn" disabled={busy || !co} onClick={() => run("Envoyé au livreur", () => c.trk.dispatch(m.id, co))}>Envoyer au client</button>
          </>
        )}
        {role === 1 && m.status > 1 && <small>Client : {who(m.client)} · Livreur : {who(m.courier)}</small>}
        {role === 2 && m.status === 2 && <button className="btn" disabled={busy} onClick={() => run("Livraison enregistrée", () => c.trk.deliver(m.id))}>Marquer comme livré</button>}
        {role === 3 && m.status === 3 && <button className="btn" disabled={busy} onClick={() => run("Réception confirmée, paiement libéré", () => c.trk.confirmReceipt(m.id))}>Confirmer la réception</button>}
        {role === 3 && m.status >= 1 && !m.reported && !rep && <button className="btn ghost" onClick={() => setRep(true)}>Signaler un problème</button>}
        {rep && (
          <>
            <label className="field">Décrivez le problème<input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Boîte abîmée, lot différent…" /></label>
            <button className="btn" disabled={busy || !details.trim()} onClick={() => run("Signalement envoyé", () => c.trk.reportProblem(m.id, details.trim()), () => setRep(false))}>Envoyer</button>
          </>
        )}
        <button className="btn ghost" onClick={open}>Voir le suivi</button>
      </div>
    </article>
  );
}

function Directory({ people, me, provider, notify }) {
  const [filter, setFilter] = useState(0);
  const [q, setQ] = useState("");
  const [bal, setBal] = useState({});

  // Charge le solde de chaque utilisateur inscrit
  useEffect(() => {
    (async () => {
      const out = {};
      for (const p of people) {
        try { out[p.address] = formatEther(await provider.getBalance(p.address)); }
        catch { out[p.address] = null; }
      }
      setBal(out);
    })();
  }, [people, provider]);

  const list = people.filter(
    (p) => (filter === 0 || p.role === filter) &&
      (p.name + p.address).toLowerCase().includes(q.toLowerCase())
  );
  const count = (r) => people.filter((p) => p.role === r).length;

  async function copy(a) {
    try { await navigator.clipboard.writeText(a); notify("ok", "Adresse copiée"); }
    catch { notify("err", "Copie impossible"); }
  }

  return (
    <>
      <h2>Annuaire</h2>
      <p className="sub">
        {people.length} comptes inscrits : {count(1)} pharmacie(s), {count(2)} livreur(s), {count(3)} client(s).
        Ces informations sont publiques sur la blockchain.
      </p>
      <div className="panel">
        <div className="row-form">
          <label className="field">Rôle
            <select value={filter} onChange={(e) => setFilter(Number(e.target.value))}>
              <option value={0}>Tous</option>
              <option value={1}>Pharmacies</option>
              <option value={2}>Livreurs</option>
              <option value={3}>Clients</option>
            </select>
          </label>
          <label className="field">Recherche
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom ou adresse" />
          </label>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dir">
            <thead><tr><th>Nom</th><th>Rôle</th><th>Portefeuille</th><th>Solde</th><th></th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.address}>
                  <td data-label="Nom"><span>{p.name} {p.address.toLowerCase() === me.toLowerCase() && <span className="chip">Vous</span>}</span></td>
                  <td data-label="Rôle">{ROLES[p.role]}</td>
                  <td data-label="Portefeuille"><code>{p.address}</code></td>
                  <td data-label="Solde">{bal[p.address] == null ? "…" : Number(bal[p.address]).toFixed(3) + " ETH"}</td>
                  <td className="cell-actions"><button className="btn ghost" onClick={() => copy(p.address)}>Copier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 && <p className="empty">Aucun compte ne correspond.</p>}
      </div>
    </>
  );
}

function Track({ c, id, who, items }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const [name, batch, exp, pharmacy, price] = await c.reg.getMedicine(id);
        const [st, client, courier, reported, paid] = await c.trk.getTracking(id);
        const history = await c.trk.getHistory(id);
        const reports = await c.trk.getReports(id);
        const expired = await c.reg.isExpired(id);
        setD({ name, batch, exp: Number(exp), pharmacy, price, st: Number(st), client, courier, paid, history, reports, expired });
        setErr("");
      } catch {
        setD(null);
        setErr("Aucun médicament avec ce numéro. Vérifiez le numéro et réessayez.");
      }
    })();
  }, [id, c, items]);

  if (err) return <p className="panel empty">{err}</p>;
  if (!d) return <p className="empty">Chargement…</p>;
  const [phShare, coShare] = split(d.price);
  return (
    <section className="panel detail">
      <div>
        <h3>{d.name} <small style={{ color: "var(--muted)", fontWeight: 400 }}>n°{id} · lot {d.batch}</small></h3>
        <p className="sub">Pharmacie : {who(d.pharmacy)} · Péremption : {fmtDay(d.exp)} {d.expired && <span className="chip bad">Périmé</span>}</p>
        <p className="sub">
          Prix : {eth(d.price)} · Pharmacie 80 % : {eth(phShare)} · Livreur 20 % : {eth(coShare)}
          {d.st === LAST ? " · Paiement libéré" : d.paid > 0n ? " · Paiement bloqué jusqu'à la réception" : ""}
        </p>
        {d.client !== ZERO && <p className="sub">Client : {who(d.client)}{d.courier !== ZERO && <> · Livreur : {who(d.courier)}</>}</p>}
        <Journey status={d.st} />
        <ul className="timeline">
          {d.history.length === 0 && <li>Enregistré par la pharmacie. En attente de commande.</li>}
          {d.history.map((h, i) => (
            <li key={i}><b>{STATUSES[Number(h.status)]}</b><small>{who(h.author)} ({short(h.author)}) · {fmt(h.timestamp)}</small></li>
          ))}
        </ul>
        {d.reports.map((r, i) => <div className="report" key={i}><b>Signalement</b> · {who(r.author)} · {fmt(r.timestamp)}<br />{r.details}</div>)}
      </div>
      <div className="qr">
        <QRCodeSVG value={`${location.origin}/?id=${id}`} size={150} fgColor="#0B5C60" />
        Code QR du médicament n°{id}
      </div>
    </section>
  );
}