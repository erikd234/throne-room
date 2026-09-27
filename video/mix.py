import json, subprocess
cues = json.load(open('audio/cues_out.json'))
end = cues[-1]['t'] + cues[-1]['dur'] + 3.4
args = ['ffmpeg', '-y', '-i', 'audio/music.mp3']
for c in cues: args += ['-i', 'audio/' + c['file']]
f = []
vo = []
for i, c in enumerate(cues, 1):
    ms = int(c['t'] * 1000)
    f.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},volume=1.0[v{i}]")
    vo.append(f"[v{i}]")
f.append(f"{''.join(vo)}amix=inputs={len(vo)}:normalize=0,apad=whole_dur={end}[vo]")
f.append("[vo]asplit=2[vo1][vo2]")
f.append(f"[0:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:{end},volume=0.55,afade=t=in:st=0:d=0.8,afade=t=out:st={end-2.8}:d=2.8[mu]")
f.append("[mu][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350:makeup=1[duck]")
f.append("[duck][vo2]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=9[out]")
args += ['-filter_complex', ';'.join(f), '-map', '[out]', '-t', f'{end:.2f}', '-c:a', 'aac', '-b:a', '192k', 'out/mix.m4a']
subprocess.run(args, check=True, capture_output=True)
print('mix ok', round(end, 2))
