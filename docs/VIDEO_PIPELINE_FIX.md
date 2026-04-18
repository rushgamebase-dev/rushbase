# Video Pipeline Fix — ffmpeg pipe + yolo12s + rAF single-flight

**Data**: 2026-04-10
**Git tag**: `video-smooth-ffmpeg-pipe`
**Status**: validado em produção nas câmeras Peace Bridge e Konya

Este documento descreve correções estruturais no pipeline de vídeo do oracle. As
mudanças estão no engine de detecção da `oracle/` e nos hooks de frontend;
os caminhos e nomes de arquivo abaixo refletem o código realmente em produção.

## TL;DR

O live stream de vídeo tinha **travadinhas frequentes de 500-1500ms**
("quase quase lá" era a avaliação do user durante meses). Esse documento
registra o que causou, o que foi corrigido, e **o que NÃO reverter**.

Se você está lendo isso porque o vídeo voltou a travar: **não tire as
4 mudanças listadas abaixo sem medir**. Cada uma teve causa técnica
identificada e validada.

## Sintoma original

- Gaps visuais de 500-1600ms a cada ~4 segundos
- Múltiplas sessões perdidas tentando PyAV ring buffer, CF Stream
  RTMPS, threaded reader sem queue, etc — **tudo piorou**
- Reversão ao `cv2.VideoCapture` original dava "quase quase lá" mas
  não perfeito

## Causa raiz (confirmada por instrumentação)

### Causa principal (80% do jitter): HLS segment boundaries via cv2

`cv2.VideoCapture(..., cv2.CAP_FFMPEG)` com HLS entrega frames em
bursts por segmento. Entre segmentos, `cap.read()` **bloqueia** esperando
o próximo chunk chegar. Com segments de ~5s do YouTube HLS, isso dava:

- `reader_gap_ms` p50 ≈ 880ms, p95 ≈ 1659ms
- `queue_empty_per_10s` ≈ 485 (main loop 48% do tempo em Empty)
- Cliente vê: burst curto de frames + freeze longo

Medição direta confirmou: o gargalo era o `cap.read()`, não YOLO, não
encoding, não WebSocket, não rede.

### Causa secundária (20%): `setFrameUrl` sem rAF no frontend

`frontend/hooks/useOracleState.ts` fazia `setFrameUrl(url)` síncrono
dentro do `ws.onmessage`. Como `useOracleState` é desestruturado na raiz
do `app/page.tsx`, **toda a página re-renderiza a cada frame**. Em bursts
isso gerava long tasks de 100-200ms no main thread (medido com
`raf_delay_ms`).

## As 4 mudanças que resolveram

### 1. `cv2.VideoCapture` → `subprocess.Popen(ffmpeg, rawvideo BGR24)`

**Arquivo**: detection engine em `oracle/` (função `process_video`)

ffmpeg subprocess com pipe de raw BGR24 tem buffer interno muito melhor
que OpenCV com CAP_FFMPEG. Não trava no read() entre segments.

```python
ffmpeg_cmd = [
    "ffmpeg",
    "-hide_banner", "-loglevel", "warning",
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    *probe_headers,           # Referer p/ konya etc
    "-i", direct_url,
    "-f", "rawvideo",
    "-pix_fmt", "bgr24",
    "-an", "-sn",
    "pipe:1",
]
ff_proc = subprocess.Popen(
    ffmpeg_cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    bufsize=frame_w * frame_h * 3 * 8,
)
```

Reader thread lê `frame_w * frame_h * 3` bytes por iteração e
converte com `np.frombuffer(...).reshape(h, w, 3).copy()`.

**Dimensões + fps são descobertas via `ffprobe` antes do spawn.**

### IMPORTANTE — NÃO ADICIONAR estes flags

Durante os testes, adicionei flags de "low-latency" no ffmpeg e a
**qualidade visual caiu** (artifacts de H.264 por decode agressivo):

```
-fflags nobuffer+discardcorrupt
-flags low_delay
```

- `discardcorrupt`: dropa ref frames → B-frames subsequentes ficam com
  pixelação
- `nobuffer`/`low_delay`: força decoder a cuspir frames sem buffer
  adequado

**Mantemos o ffmpeg em modo padrão**. A latência continua baixa
porque o reader thread + Queue(2) + main loop asyncio já mantém
o caminho curto.

### 2. Modelo YOLO: `yolov8x.pt` → `yolo12s.pt`

**Arquivo**: detection engine em `oracle/` (argparse `--model` default)

`yolov8x` (137MB) era ~40-150ms por frame na RTX 3090 com `imgsz=1280`.
`yolo12s` (19MB) é consistentemente ~8-15ms. Acurácia de vehicle
count é equivalente para o caso de uso (contar veículos cruzando linha).

O modelo `yolo12s.pt` mora em `oracle/yolo12s.pt`. Se sumir, baixar de
novo da distribuição oficial de weights do Ultralytics para o tamanho
`s` (small) da linha YOLOv12.

### 3. Throttle no main loop = native HLS fps

**Arquivo**: detection engine em `oracle/` (dentro de `process_video`)

Com `yolo12s`, o main loop rodava muito mais rápido que o fps nativo do
stream. Resultado: **vídeo em fast-forward** (cliente via o vídeo em
~2-3x velocidade).

Fix: descobrir fps nativo via ffprobe e dormir o suficiente para
manter esse ritmo.

```python
native_fps = float(num) / float(den)  # lido do ffprobe r_frame_rate
frame_interval = 1.0 / native_fps

# ... no main loop, após broadcast:
elapsed = time.time() - frame_start
if elapsed < frame_interval:
    await asyncio.sleep(frame_interval - elapsed)
```

**NÃO usar `target_fps` hardcoded (ex: 8 ou 10)**. O throttle tem que
ser o fps nativo porque:
- `target_fps` menor = choppy visualmente
- `target_fps` maior = fast-forward (ou sem efeito, já que não tem mais
  frames pra consumir)

### 4. `setFrameUrl` via `requestAnimationFrame` single-flight

**Arquivo**: `frontend/hooks/useOracleState.ts` (dentro do
`handleMessage`, branch `Blob | ArrayBuffer`)

O `setFrameUrl` antes era síncrono no `onmessage`. Agora é envolto em
um rAF single-flight:

- Cada frame novo cria o objectURL e armazena em `pendingUrlRef`
- O `setFrameUrl` é chamado **no callback do rAF**, garantindo que
  acontece no máximo uma vez por vsync
- Se vários frames chegam entre vsyncs (burst), só o mais recente
  sobrevive; os anteriores são revogados imediatamente (sem leak)
- Padrão clássico "latest wins" alinhado com vsync

**NÃO remover o `requestAnimationFrame`.** Fazer `setFrameUrl` direto
causa React rerender em cascata do `page.tsx` inteiro.

## O que NÃO tocar (lições aprendidas)

- `Queue(maxsize=2)` no reader — NÃO aumentar (vira latência), NÃO
  reduzir para 1 (vira drop massivo).
- `put(f, timeout=1)` no reader — NÃO trocar para `put_nowait +
  drop-oldest`. Eu tentei, **quebrou tudo**: reader starvation, gaps
  viraram 5000ms constantes. A sincronização implícita do `put(timeout=1)`
  com o main loop via `get_nowait()` é o que faz a Queue(2) funcionar
  como look-ahead.
- `JPEG_QUALITY = 65` — confirmed OK.
- `OUTPUT_WIDTH = 1920` — confirmed OK (rawvideo já vem no tamanho nativo do stream).
- Tunnel cloudflared — não é problema do vídeo. Nunca restart sem
  comando explícito.
- `createImageBitmap` no frontend — causa GC stalls. Ficar com
  `Image + createObjectURL`.
- `asyncio.sleep(0.02)` no Empty branch do main loop — OK, não trocar.
- **NÃO adicionar flags low-latency do ffmpeg** (ver seção 1).

## Benchmarks antes/depois

| Métrica | Antes (cv2) | Depois (ffmpeg pipe) |
|---|---|---|
| `reader_gap_ms` p50 | 880ms | dentro do threshold (< 100ms) |
| `reader_gap_ms` p95 | 1659ms | ocasionais 500-700ms |
| `queue_empty_per_10s` | ~485 | ~80-90 |
| `yolo_ms` (yolov8x) | 40-150ms variável | — |
| `yolo_ms` (yolo12s) | — | 8-15ms estável |
| Velocidade visual | travadinhas constantes | user: "perfeito" |

## Ambiente de teste

- GPU: RTX 3090 24GB
- Python 3.13, ultralytics 8.4.32
- ffmpeg 6.1.1, ffprobe 6.1.1
- Cameras validadas: `peace-bridge` (YouTube HLS, 1280x720 @ 30fps),
  `konya-turkey-19` (HLS direto TrafficVision, 1920x1080 @ 25fps com
  Referer header)
- Next.js 14.2.35 dev server (localhost) + Chrome

## Em caso de regressão

1. Primeiro verificar o fps nativo do stream (`ffprobe`). Se o
   throttle está errado (não casa com o fps), video vai ficar fast-forward
   ou lento demais.
2. Verificar se `yolo12s.pt` existe em `oracle/`. Se não, baixar de novo.
3. Verificar se o ffmpeg tem os flags conservadores (sem `-fflags
   nobuffer`, sem `-flags low_delay`, sem `discardcorrupt`). Se alguém
   tiver adicionado, remover.
4. Conferir `useOracleState.ts`: `setFrameUrl` tem que estar **dentro
   do `requestAnimationFrame` callback**, não direto no `onmessage`.
5. Conferir que o reader usa `put(f, timeout=1)`, **não**
   `put_nowait` + drop-oldest.
6. Confirmar que existe apenas uma instância do detection engine rodando.

Se nada disso bater, `git checkout video-smooth-ffmpeg-pipe` e começar
a bisseccionar.
