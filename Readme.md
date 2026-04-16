# WAVECUT — Audio Editor

Editor de áudio 100% local no navegador. Nenhum dado enviado a servidores.

## Como usar

Abra o `index.html` diretamente no navegador **ou** use a extensão **Live Server** no VSCode para melhor experiência (hot reload).

### Extensão recomendada

- **Live Server** (Ritwick Dey) — clique com botão direito no `index.html` → "Open with Live Server"

---

## Funcionalidades

### Edição

| Ação              | Como                                         |
| ----------------- | -------------------------------------------- |
| Carregar áudio    | Arraste o arquivo ou clique na área de drop  |
| Selecionar região | Ative "Selecionar" e arraste na waveform     |
| Cortar seleção    | Botão "Cortar" (remove o trecho selecionado) |
| Dividir           | Marca ponto de divisão (linha vermelha)      |
| Desfazer          | Botão "↩ Desfazer" (até 20 passos)           |
| Reset total       | Botão "↺ Reset"                              |

### Efeitos

| Efeito       | Faixa              |
| ------------ | ------------------ |
| Volume       | 0% → 200%          |
| Speed        | 0.25× → 4×         |
| Pitch        | -24 → +24 semitons |
| Bass Boost   | -20 → +20 dB       |
| Reverb       | 0% → 100%          |
| Reverb Decay | 0.1s → 6s          |

### Export

- **WAV** — sem perdas, arquivo maior
- **MP3** — comprimido, 4 opções de qualidade (96 / 128 / 192 / 320 kbps)
- Se houver pontos de divisão, cada segmento é exportado como arquivo separado

---

## Formatos suportados

MP3, WAV, OGG, FLAC, M4A (qualquer formato que o navegador suporte)

## Tecnologias

- Web Audio API (nativo)
- [lamejs](https://github.com/nicktindall/lamejs) — encoder MP3 em JavaScript puro
- Google Fonts — IBM Plex Mono + Syne

## Estrutura

```
audio-editor/
├── index.html   # Estrutura HTML
├── style.css    # UI dark industrial
├── app.js       # Lógica de áudio
└── README.md    # Este arquivo
```
