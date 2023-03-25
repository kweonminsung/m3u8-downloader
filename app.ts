import * as ffmpegPath from 'ffmpeg-static';
import * as ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { AxiosError } from 'axios';
import * as fs from 'fs';
import * as readline from 'readline';
import * as m3u8Parser from 'm3u8-parser';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const parser = new m3u8Parser.Parser();

ffmpeg.setFfmpegPath(ffmpegPath);

rl.question('=> Input m3u8 URL: ', answer => {
  const m3u8URL = answer;

  rl.question('=> Input Referer URL(ENTER if no referer): ', async answer => {
    const refererURL = answer !== '' ? answer : undefined;

    await getm3u8File(m3u8URL, refererURL);

    parser.push(fs.readFileSync('temp/video.m3u8').toString());
    parser.end();

    await downloadFragments(m3u8URL, refererURL);

    await mergeFragments();

    rl.close();
  });
});

const getm3u8File = async (m3u8URL: string, refererURL: string) => {
  try {
    fs.mkdirSync('temp');
  } catch (err) {}

  try {
    const m3u8FileResponse = await axios({
      method: 'get',
      url: m3u8URL,
      headers: {
        Referer: refererURL,
      },
    });

    fs.writeFileSync('temp/video.m3u8', m3u8FileResponse.data);
  } catch (err: AxiosError | unknown) {
    if (err instanceof AxiosError) {
      console.log(err.response?.status);
    }
  }
};

const downloadFragments = async (m3u8URL: string, refererURL: string) => {
  try {
    const fragments = parser.manifest.segments;

    const fragmentResponses = await Promise.all(
      fragments.map(fragment => {
        return axios({
          method: 'get',
          url: m3u8URL.slice(0, -10) + fragment.uri,
          responseType: 'stream',
          headers: {
            Referer: refererURL,
          },
        });
      })
    );

    fragmentResponses.forEach((fragmentResponse, index) => {
      fragmentResponse.data.pipe(fs.createWriteStream(`temp/video${index}.ts`));
      console.log(`=> Downloaded fragment video${index}.ts`);
    });
  } catch (err: AxiosError | unknown) {
    if (err instanceof AxiosError) {
      console.log(err.response?.status);
    }
  }
};

const mergeFragments = async () =>
  new Promise((resolve, reject) => {
    ffmpeg()
      .input('temp/video.m3u8')
      .output('video.mp4')
      .outputOptions([
        '-bsf:a aac_adtstoasc',
        '-c copy',
        '-movflags +faststart',
      ])
      .on('error', function (err) {
        console.log('=> Error occurred: ' + err.message);
        reject();
      })
      .on('end', function () {
        console.log('=> Merging finished');

        fs.rmdirSync('temp', { recursive: true });

        resolve(null);
      })
      .run();
  });
