"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/theme";
import type { DiscordConfig } from "@/lib/discordConfig";

type Status = { kind: "idle" | "saving" | "ok" | "err"; msg?: string };

export default function DiscordConfigForm({ initial, canEdit }: { initial: DiscordConfig; canEdit: boolean }) {
  const router = useRouter();
  const ro = !canEdit;
  const [guildId, setGuildId] = useState(initial.guildId);
  const [staff, setStaff] = useState(initial.staffRoleIds.join(", "));
  const [cnw, setCnw] = useState(initial.confirmNodewar);
  const [csg, setCsg] = useState(initial.confirmSiege);
  const [log, setLog] = useState(initial.logChannel);
  const [rep, setRep] = useState(initial.reportChannel);
  const [regRole, setRegRole] = useState(initial.registroRoleId);
  const [regChan, setRegChan] = useState(initial.registerChannel);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function salvar() {
    setStatus({ kind: "saving" });
    try {
      const body = { guildId, staffRoleIds: staff.split(",").map((s) => s.trim()).filter(Boolean), confirmNodewar: cnw, confirmSiege: csg, logChannel: log, reportChannel: rep, registroRoleId: regRole, registerChannel: regChan };
      const res = await fetch("/api/discord-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "falha ao salvar");
      const dc = d as DiscordConfig;
      setGuildId(dc.guildId); setStaff(dc.staffRoleIds.join(", ")); setCnw(dc.confirmNodewar); setCsg(dc.confirmSiege); setLog(dc.logChannel); setRep(dc.reportChannel); setRegRole(dc.registroRoleId); setRegChan(dc.registerChannel);
      setStatus({ kind: "ok", msg: "Config salva. Faça logout/login pra revalidar o acesso." });
    } catch (e) { setStatus({ kind: "err", msg: (e as Error).message }); }
  }

  const card = { border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, padding: 18 } as const;
  const input = { background: C.inputBg, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.texto, padding: "8px 11px", fontSize: 13.5, outline: "none", width: "100%" } as const;
  const label = { color: C.mute, fontSize: 11.5, textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 4, display: "block" };
  const dica = { color: C.borderSoft, fontSize: 11.5, marginTop: 3 } as const;

  return (
    <div style={{ minHeight: "100vh", background: C.bgGlow, padding: "26px 24px", color: C.texto, fontFamily: "'Chakra Petch', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Chakra+Petch:wght@400;500;600&display=swap');
        a.navlink{color:${C.mute};text-decoration:none;font-size:13px;letter-spacing:1px} a.navlink:hover{color:${C.verde}}`}</style>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/mascot.png" alt="" width={38} height={38} style={{ filter: "drop-shadow(0 0 10px rgba(204,0,0,.45))" }} />
            <h1 style={{ fontFamily: "'Share Tech Mono', monospace", fontWeight: 800, fontSize: 26, letterSpacing: 1, margin: 0, color: C.amarelo }}>
              BAYGON <span style={{ color: C.mute, fontSize: 14, letterSpacing: 2 }}>· DISCORD</span>
            </h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Link className="navlink" href="/painel">← Painel</Link>
            <Link className="navlink" href="/participacao">Participação</Link>
            {ro && <span style={{ color: C.amarelo, fontSize: 12, border: `1px solid ${C.border2}`, borderRadius: 999, padding: "3px 10px" }}>🔒 somente leitura</span>}
            {status.kind === "ok" && <span style={{ color: C.verde, fontSize: 13 }}>✓ salvo</span>}
            {status.kind === "err" && <span style={{ color: C.vermelho, fontSize: 13 }}>⚠ {status.msg}</span>}
            {canEdit && <button onClick={salvar} disabled={status.kind === "saving"} style={{ borderRadius: 8, border: `1px solid ${C.border2}`, background: C.inputBg, color: C.amarelo, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{status.kind === "saving" ? "Salvando…" : "Salvar"}</button>}
          </div>
        </div>

        <p style={{ color: C.mute, fontSize: 12.5, margin: "0 0 16px" }}>
          Define <b style={{ color: C.verde }}>qual servidor</b> toda a solução usa (login, bot, emojis, canais). Campo vazio usa o valor do ambiente (env). Pra pegar um ID: no Discord, ative o Modo Desenvolvedor → clique direito → <b>Copiar ID</b>. Depois de trocar o servidor, o bot precisa estar nele e você deve <b>relogar</b>.
        </p>
        <p style={{ color: C.amarelo, fontSize: 12.5, margin: "0 0 16px", border: `1px solid ${C.border2}`, borderRadius: 10, padding: "9px 12px", background: C.inputBg }}>
          ⚠ Trocar de servidor <b>não se resolve só aqui</b>. Também precisa: o canal onde o bot posta a chamada
          (fica em <Link href="/participacao" style={{ color: C.verde }}>Participação</Link>, não nesta tela), registrar
          os <b>slash commands</b> no servidor novo (<code>scripts/register_commands.mjs</code>) e todo mundo <b>relogar</b>.
        </p>

        <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={label}>Servidor ativo (Guild ID)</label><input value={guildId} readOnly={ro} onChange={(e) => setGuildId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do servidor" style={input} /><div style={dica}>Onde o login é liberado e o bot opera.</div></div>
          <div><label style={label}>Cargos de staff (IDs, separados por vírgula)</label><input value={staff} readOnly={ro} onChange={(e) => setStaff(e.target.value)} placeholder="123, 456 (vazio = todos editam)" style={input} /><div style={dica}>Quem pode editar no site e disparar o bot. Vazio = todo membro edita.</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label style={label}>Canais Apollo — Nodewar</label><input value={cnw} readOnly={ro} onChange={(e) => setCnw(e.target.value.replace(/[^0-9,\s]/g, ""))} placeholder="ID (ou vários, separados por vírgula)" style={input} /></div>
            <div><label style={label}>Canais Apollo — Siege</label><input value={csg} readOnly={ro} onChange={(e) => setCsg(e.target.value.replace(/[^0-9,\s]/g, ""))} placeholder="ID (ou vários, separados por vírgula)" style={input} /></div>
          </div>
          <div style={dica}>Canais de onde a tela de Confirmados lê o embed do Apollo (por modo). Aceita <b>vários IDs separados por vírgula</b> — quando o Apollo posta um evento por canal (ex.: um por dia da semana), lemos todos e usamos o post mais recente.</div>
          <div><label style={label}>Canal de log (respostas livres)</label><input value={log} readOnly={ro} onChange={(e) => setLog(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do canal" style={input} /><div style={dica}>Onde o bot posta as respostas de texto livre (modal “Responder” e /responder), cada uma com um código.</div></div>
          <div><label style={label}>Canal do relatório do Buzinador (padrão)</label><input value={rep} readOnly={ro} onChange={(e) => setRep(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do canal" style={input} /><div style={dica}>Canal padrão onde o Buzinador posta o relatório de entrega/votação. No painel dá pra sobrescrever por disparo.</div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12 }}>
            <div><label style={label}>Cargo de registrado (ID)</label><input value={regRole} readOnly={ro} onChange={(e) => setRegRole(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do cargo" style={input} /></div>
            <div><label style={label}>Canal do /register</label><input value={regChan} readOnly={ro} onChange={(e) => setRegChan(e.target.value.replace(/[^0-9]/g, ""))} placeholder="ID do canal (vazio = qualquer)" style={input} /></div>
          </div>
          <div style={dica}>Jornada de registro: cargo dado ao concluir + canal onde o /register funciona. ⚠ O bot precisa de <b>Gerenciar Cargos</b> e <b>Gerenciar Apelidos</b>, e o cargo de registrado deve ficar <b>abaixo</b> do cargo do bot.</div>
        </div>

        {status.kind === "ok" && <div style={{ color: C.verde, fontSize: 12.5, marginTop: 10 }}>✓ {status.msg}</div>}
      </div>
    </div>
  );
}
