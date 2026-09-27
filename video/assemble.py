# Combine rendered frames + mixed audio + real footage overlays into the final MP4.
import json, subprocess
C = {c['id']: c for c in json.load(open('audio/cues_out.json'))}
A = lambda i: C[i]['t']; E = lambda i: C[i]['t'] + C[i]['dur']
def dur(f): return float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f],capture_output=True,text=True).stdout)
# (file, window start, window end, source start, source end, crop, x, y, w, h)
slots = [
  ('real/real_proof.mp4', A('real') + .1, E('real') + .3, 3.0, 11.8, 'crop=760:960:580:60', 1180, 40, 681, 860),
  ('real/real_brain.mp4', A('write') - .05, E('write') + .35, 0.0, dur('real/real_brain.mp4') - .1, None, 44, 552, 560, 315),
  ('real/real_multiplayer.mp4', A('multi') + .45, A('hand') + 1.85, 2.5, dur('real/real_multiplayer.mp4') - .2, None, 44, 552, 560, 315),
]
args = ['ffmpeg', '-y', '-framerate', '30', '-i', 'out/frames/%05d.jpg', '-i', 'out/mix.m4a']
for s in slots: args += ['-i', s[0]]
f, last = [], '[0:v]'
for i, (fn, a, b, s0, s1, crop, x, y, w, h) in enumerate(slots):
    k = (b - a) / (s1 - s0)                         # time stretch so the clip fills the window
    chain = f"[{i+2}:v]trim={s0}:{s1},setpts=(PTS-STARTPTS)*{k:.4f}+{a:.3f}/TB"
    if crop: chain += ',' + crop
    chain += f",scale={w}:{h},format=yuv420p[c{i}]"
    f.append(chain)
    f.append(f"{last}[c{i}]overlay={x}:{y}:enable='between(t,{a:.3f},{b:.3f})':eof_action=pass[v{i}]")
    last = f'[v{i}]'
f.append(f"{last}format=yuv420p[vout]")
args += ['-filter_complex', ';'.join(f), '-map', '[vout]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
         '-r', '30', '-c:a', 'copy', '-movflags', '+faststart', '-shortest', 'out/throne-demo.mp4']
r = subprocess.run(args, capture_output=True, text=True)
print(r.stderr[-1500:] if r.returncode else 'ok out/throne-demo.mp4')
