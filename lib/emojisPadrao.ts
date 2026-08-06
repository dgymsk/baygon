import { search as buscarEmoji } from "node-emoji";

/**
 * Emojis PADRÃO do Discord (unicode), pro seletor.
 *
 * Os custom vêm da API (lib/discordApi.listarEmojisGuild), mas os padrão não: o Discord não expõe
 * lista. E `:microphone2:` só vira 🎙️ dentro do cliente dele — no nosso banco ficaria texto cru.
 * Por isso o que se GRAVA é o caractere em si, que renderiza em qualquer lugar (site, embed do bot,
 * mensagem) sem depender de servidor nenhum.
 *
 * A busca tem DUAS camadas:
 *  1. o catálogo completo do node-emoji (~1570), pelos nomes OFICIAIS — é o que faz "boom" achar 💥
 *     e "drum" achar 🥁. Lista curada à mão sempre esquece algum, e foi o que aconteceu.
 *  2. os apelidos em PT-BR abaixo, porque ninguém aqui procura "crossed_swords": procura "espada".
 *
 * Com a busca VAZIA o seletor mostra só os sugeridos — 1570 ícones de uma vez não é escolha, é
 * parede. Digitou qualquer coisa, vale o catálogo inteiro.
 */
export type EmojiPadrao = { char: string; nome: string; termos: string };

/** Os que uma guilda de war usa — aparecem primeiro, e antes de qualquer busca. */
export const EMOJIS_PADRAO: EmojiPadrao[] = [
  // guerra
  { char: "⚔️", nome: "espadas", termos: "espada guerra ataque pvp duelo combate" },
  { char: "🗡️", nome: "adaga", termos: "adaga faca espada furtivo assassino" },
  { char: "🛡️", nome: "escudo", termos: "escudo defesa tank frontline proteger" },
  { char: "🏹", nome: "arco", termos: "arco flecha ranger arqueiro distancia ranged" },
  { char: "🪓", nome: "machado", termos: "machado berserker zerk" },
  { char: "🔱", nome: "tridente", termos: "tridente lanca valquiria" },
  { char: "💣", nome: "bomba", termos: "bomba bomber explosivo" },
  { char: "🧨", nome: "dinamite", termos: "dinamite explosivo canhao" },
  { char: "🔥", nome: "fogo", termos: "fogo flame chama queimar" },
  { char: "💥", nome: "explosao", termos: "explosao impacto dano burst" },
  { char: "⚡", nome: "raio", termos: "raio cc stun choque rapido" },
  { char: "❄️", nome: "gelo", termos: "gelo frio congelar" },
  { char: "☠️", nome: "caveira", termos: "caveira morte morto kill" },
  { char: "💀", nome: "cranio", termos: "cranio morte morto kill" },
  { char: "🩸", nome: "sangue", termos: "sangue dano ferido" },
  { char: "🏰", nome: "castelo", termos: "castelo siege forte node no" },
  { char: "🚩", nome: "bandeira", termos: "bandeira pino estandarte objetivo node" },
  { char: "🎯", nome: "alvo", termos: "alvo foco mira objetivo" },
  { char: "💰", nome: "dinheiro", termos: "dinheiro prata loot recompensa" },
  // papeis
  { char: "👑", nome: "coroa", termos: "coroa lider chefe caller" },
  { char: "🎙️", nome: "microfone", termos: "microfone caller call voz shot" },
  { char: "📣", nome: "megafone", termos: "megafone chamada anuncio caller" },
  { char: "🩹", nome: "curativo", termos: "curativo cura healer shai suporte" },
  { char: "💊", nome: "remedio", termos: "remedio cura healer suporte pot" },
  { char: "🎵", nome: "nota", termos: "nota musica shai buff" },
  { char: "🐢", nome: "tartaruga", termos: "tartaruga defesa lento tank" },
  { char: "🐺", nome: "lobo", termos: "lobo flanco caçador" },
  { char: "🦅", nome: "aguia", termos: "aguia scout olheiro visao" },
  { char: "👁️", nome: "olho", termos: "olho scout visao vigia" },
  { char: "🥷", nome: "ninja", termos: "ninja furtivo kuno assassino" },
  { char: "🧙", nome: "mago", termos: "mago witch wizard magia" },
  { char: "🐉", nome: "dragao", termos: "dragao elefante montaria" },
  { char: "🐘", nome: "elefante", termos: "elefante montaria" },
  { char: "🐴", nome: "cavalo", termos: "cavalo montaria" },
  { char: "🚜", nome: "ariete", termos: "ariete estrutura maquina" },
  { char: "🏴", nome: "bandeira preta", termos: "bandeira flanco grupo" },
  // status
  { char: "✅", nome: "certo", termos: "certo ok confirmado sim aceito" },
  { char: "❌", nome: "errado", termos: "errado nao recusado cancelado" },
  { char: "⏳", nome: "ampulheta", termos: "ampulheta esperando aguardando pendente" },
  { char: "🎮", nome: "controle", termos: "controle jogo ingame jogando" },
  { char: "⭐", nome: "estrela", termos: "estrela destaque favorito core" },
  { char: "🌟", nome: "estrela brilhante", termos: "estrela brilho destaque lendario" },
  { char: "⚠️", nome: "aviso", termos: "aviso atencao cuidado alerta" },
  { char: "🔒", nome: "cadeado", termos: "cadeado restrito fechado trancado" },
  { char: "🔓", nome: "cadeado aberto", termos: "aberto liberado destrancado" },
  { char: "🆕", nome: "novo", termos: "novo new recruta" },
  { char: "🔁", nome: "repetir", termos: "repetir reserva troca rotacao" },
  { char: "🆘", nome: "socorro", termos: "socorro ajuda emergencia" },
  // formas e cores
  { char: "🔴", nome: "bola vermelha", termos: "vermelho bola circulo filler" },
  { char: "🟠", nome: "bola laranja", termos: "laranja bola circulo" },
  { char: "🟡", nome: "bola amarela", termos: "amarelo bola circulo" },
  { char: "🟢", nome: "bola verde", termos: "verde bola circulo" },
  { char: "🔵", nome: "bola azul", termos: "azul bola circulo" },
  { char: "🟣", nome: "bola roxa", termos: "roxo bola circulo" },
  { char: "⚫", nome: "bola preta", termos: "preto bola circulo" },
  { char: "⚪", nome: "bola branca", termos: "branco bola circulo" },
  { char: "🟥", nome: "quadrado vermelho", termos: "vermelho quadrado" },
  { char: "🟧", nome: "quadrado laranja", termos: "laranja quadrado" },
  { char: "🟨", nome: "quadrado amarelo", termos: "amarelo quadrado" },
  { char: "🟩", nome: "quadrado verde", termos: "verde quadrado" },
  { char: "🟦", nome: "quadrado azul", termos: "azul quadrado" },
  { char: "🟪", nome: "quadrado roxo", termos: "roxo quadrado" },
  { char: "🔶", nome: "losango laranja", termos: "laranja losango diamante" },
  { char: "🔷", nome: "losango azul", termos: "azul losango diamante" },
  // numeros e letras
  { char: "1️⃣", nome: "um", termos: "1 um numero pt1 primeiro" },
  { char: "2️⃣", nome: "dois", termos: "2 dois numero pt2 segundo" },
  { char: "3️⃣", nome: "tres", termos: "3 tres numero pt3 terceiro" },
  { char: "4️⃣", nome: "quatro", termos: "4 quatro numero pt4" },
  { char: "5️⃣", nome: "cinco", termos: "5 cinco numero pt5" },
  { char: "6️⃣", nome: "seis", termos: "6 seis numero pt6" },
  { char: "7️⃣", nome: "sete", termos: "7 sete numero pt7" },
  { char: "8️⃣", nome: "oito", termos: "8 oito numero pt8" },
  { char: "🅰️", nome: "letra A", termos: "a letra grupo" },
  { char: "🅱️", nome: "letra B", termos: "b letra grupo" },
  // setas e direcoes
  { char: "⬅️", nome: "esquerda", termos: "esquerda seta flanco" },
  { char: "➡️", nome: "direita", termos: "direita seta flanco" },
  { char: "⬆️", nome: "cima", termos: "cima seta frente avancar" },
  { char: "⬇️", nome: "baixo", termos: "baixo seta recuar" },
  { char: "↔️", nome: "lados", termos: "lados seta flanco duplo" },
  { char: "🔃", nome: "girar", termos: "girar rotacao troca" },
  // gente
  { char: "🧍", nome: "pessoa", termos: "pessoa membro jogador" },
  { char: "👥", nome: "duas pessoas", termos: "pessoas grupo party pt time" },
  { char: "🤝", nome: "aperto de mao", termos: "alianca acordo amigo aliado" },
  { char: "🎉", nome: "festa", termos: "festa vitoria comemorar" },
  { char: "🏆", nome: "trofeu", termos: "trofeu vitoria campeao primeiro" },
  { char: "😀", nome: "sorriso", termos: "sorriso feliz" },
  { char: "😎", nome: "oculos", termos: "oculos estiloso confiante" },
  { char: "🤡", nome: "palhaco", termos: "palhaco piada" },
  { char: "🫡", nome: "continencia", termos: "continencia salute respeito" },
];

/**
 * Sem busca devolve os sugeridos; com busca, os apelidos PT-BR primeiro (mais prováveis de ser o
 * que a pessoa quer) e depois o catálogo oficial inteiro, sem repetir caractere.
 */
export function filtrarPadrao(q: string): EmojiPadrao[] {
  const t = q.trim().toLowerCase();
  if (!t) return EMOJIS_PADRAO;

  const out: EmojiPadrao[] = [];
  const vistos = new Set<string>();
  const por = (e: EmojiPadrao) => { if (!vistos.has(e.char)) { vistos.add(e.char); out.push(e); } };

  for (const e of EMOJIS_PADRAO) if (e.nome.includes(t) || e.termos.includes(t) || e.char === t) por(e);
  // o catálogo oficial: nomes em inglês, que é como o Discord os chama (:boom:, :drum:)
  try {
    for (const r of buscarEmoji(t)) por({ char: r.emoji, nome: r.name, termos: r.name });
  } catch { /* dataset indisponível não pode derrubar o seletor */ }
  return out;
}
