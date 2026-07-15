// voice.js — Azure AI Speech: hearing (speech->text) and voice (text->speech).
//
// Requires AZURE_SPEECH_KEY and AZURE_SPEECH_REGION. This is the production voice
// path; the browser Web Speech API demo in public/voice.html needs none of this
// and is the zero-cost way to try the experience first.
//
// transcribe(wavBuffer) -> Promise<string>
// synthesize(text)      -> Promise<Buffer>  (audio/mpeg)
let sdk;
try { sdk = require('microsoft-cognitiveservices-speech-sdk'); } catch (_) { sdk = null; }

function speechConfig() {
  if (!sdk) throw new Error('microsoft-cognitiveservices-speech-sdk is not installed');
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error('AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are not set');
  return sdk.SpeechConfig.fromSubscription(key, region);
}

function transcribe(wavBuffer) {
  return new Promise((resolve, reject) => {
    let cfg;
    try { cfg = speechConfig(); } catch (e) { return reject(e); }
    const audio = sdk.AudioConfig.fromWavFileInput(Buffer.from(wavBuffer));
    const recognizer = new sdk.SpeechRecognizer(cfg, audio);
    recognizer.recognizeOnceAsync(
      (result) => {
        recognizer.close();
        if (result && result.reason === sdk.ResultReason.RecognizedSpeech) resolve(result.text);
        else reject(new Error(`no speech recognized (reason ${result && result.reason})`));
      },
      (err) => { recognizer.close(); reject(new Error(String(err))); }
    );
  });
}

function synthesize(text, voiceName = process.env.AZURE_SPEECH_VOICE || 'en-US-JennyNeural') {
  return new Promise((resolve, reject) => {
    let cfg;
    try { cfg = speechConfig(); } catch (e) { return reject(e); }
    cfg.speechSynthesisVoiceName = voiceName;
    cfg.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
    const synth = new sdk.SpeechSynthesizer(cfg, null);
    synth.speakTextAsync(
      text,
      (result) => {
        synth.close();
        if (result && result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve(Buffer.from(result.audioData));
        } else {
          reject(new Error(`synthesis failed (reason ${result && result.reason})`));
        }
      },
      (err) => { synth.close(); reject(new Error(String(err))); }
    );
  });
}

module.exports = { transcribe, synthesize };
