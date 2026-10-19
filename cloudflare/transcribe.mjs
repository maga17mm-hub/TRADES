import {ApiError} from './accounts.mjs';

export async function transcribe(body, env) {
  if (!env.AI) throw new ApiError('Распознавание речи ещё не подключено.', 503);
  if (typeof body.audio !== 'string' || body.audio.length < 100 || body.audio.length > 5600000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)) throw new ApiError('Некорректная или слишком большая запись. Запишите фразу до 45 секунд.');
  try {
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: body.audio, language: 'ru', task: 'transcribe', vad_filter: true,
      condition_on_previous_text: false
    });
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (!text) throw new ApiError('Речь не слышна. Поднесите микрофон ближе и попробуйте снова.', 422);
    return {text: text.slice(0, 6000)};
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Transcription failure:', error.name, /quota|limit|neurons/i.test(error.message || '') ? 'quota' : 'upstream');
    throw new ApiError(/quota|limit|neurons/i.test(error.message || '')
      ? 'Дневной бесплатный лимит распознавания исчерпан. Попробуйте завтра или введите текст.'
      : 'Не удалось распознать запись. Попробуйте ещё раз.', 502);
  }
}
