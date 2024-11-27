'use strict';

const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const axios = require('axios').default;
const qs = require('qs');
const natural = require('natural');
const word2vec = require('word2vec');

const ALLOWED_ORIGINS = [
  'http://127.0.0.1:[0-9]*',
  'http://localhost:[0-9]*',
  'https://www.google.com',
];
const LANGUAGE = 'EN'; // 言語設定（英語）
const DEFAULT_CATEGORY = 'N'; // デフォルトの品詞カテゴリ（名詞）
const DEFAULT_CATEGORY_CAPITALIZED = 'NNP'; // 大文字で始まる単語のデフォルト品詞カテゴリ（固有名詞）
const MODEL_FILE = 'glove.6B.100d.word2vec.txt';

const cx = process.env.CX;
const key = process.env.KEY;
const wordnet = new natural.WordNet();
const tokenizer = new natural.WordTokenizer(); // 単語トークナイザーの作成
// 品詞タグ付け用の辞書の作成
const lexicon = new natural.Lexicon(
  LANGUAGE,
  DEFAULT_CATEGORY,
  DEFAULT_CATEGORY_CAPITALIZED
);
// 品詞タグ付け用のルールセットの作成
const ruleSet = new natural.RuleSet(LANGUAGE);
// Brillの品詞タグ付け器の作成
const tagger = new natural.BrillPOSTagger(lexicon, ruleSet);
const s3ClientConfig = {};

let s3Client;

if (process.env.IS_OFFLINE) {
  s3ClientConfig.forcePathStyle = true;
  s3ClientConfig.credentials = {
    accessKeyId: 'S3RVER', // This specific key is required when working offline
    secretAccessKey: 'S3RVER',
  };
  s3ClientConfig.endpoint = 'http://localhost:4569';
} else {
  s3Client = new S3Client(s3ClientConfig);
}

/**
 * getRelatedWords 
 */
const getRelatedWords = (word) => {
  return new Promise((resolve) => {
    const relatedWords = [];
    wordnet.lookup(word, (results) => {
      if (!results || results.length === 0) {
        // 結果がない場合は空の配列を返す
        return resolve(relatedWords);
      }

      let pending = 0;

      results.forEach((result) => {
        if (result.ptrs && result.ptrs.length > 0) {
          result.ptrs.forEach((ptr) => {
            if (ptr.pointerSymbol === '@' || ptr.pointerSymbol === '~') {
              pending++;
              wordnet.get(ptr.synsetOffset, ptr.pos, (conceptResult) => {
                relatedWords.push(conceptResult.lemma);
                pending--;

                if (pending === 0) {
                  resolve(relatedWords);
                }
              });
            }
          });
        }
      });

      // もし pending が 0 の場合、関連語がないため即座に resolve
      if (pending === 0) {
        resolve(relatedWords);
      }
    });
  });
};

module.exports.search = async (event) => {
  const origin = event.headers.origin;
  const headers = {
    'Access-Control-Allow-Origin': '*',
  };
  let modelPath;
  let model;

  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = true;
  }

    if (process.env.IS_OFFLINE) {
    // ローカル環境での処理
    console.log('ローカル環境です。ローカルのモデルファイルを使用します。');
    // ローカルのvectors.txtへのパスを設定
    modelPath = path.join(__dirname, MODEL_FILE);
    
    if (!fs.existsSync(modelPath)) {
      console.error('ローカルのモデルファイルが見つかりません。');
      return {
        body: JSON.stringify({
          error: 'ローカルのモデルファイルが見つかりません。',
        }),
        statusCode: 500,
        headers,
      };
    }
  } else {
    // AWS環境での処理
    console.log('AWS環境です。S3からモデルファイルを取得します。');
    
    const localFilePath = `/tmp/${MODEL_FILE}`;

    modelPath = localFilePath;
    try {
      // キャッシュの確認
      if (!fs.existsSync(localFilePath)) {
        console.log('モデルファイルをS3からダウンロードします...');
        const getObjectParams = {
          Bucket: process.env.S3_BUCKET,
          Key: MODEL_FILE,
        };
        const command = new GetObjectCommand(getObjectParams);
        const data = await s3Client.send(command);
        // ストリームをファイルに書き込む
        const writableStream = fs.createWriteStream(localFilePath);

        await new Promise((resolve, reject) => {
          data.Body.pipe(writableStream)
            .on('finish', resolve)
            .on('error', reject);
        });

        console.log('モデルファイルをダウンロードしました。');
      } else {
        console.log('キャッシュされたモデルファイルを使用します。');
      }
    } catch (error) {
      console.error('モデルファイルの取得中にエラーが発生しました:', error);
      return {
        body: JSON.stringify({ error: 'モデルファイルの取得に失敗しました。' }),
        headers,
        statusCode: 500,
      };
    }
  }

  // モデルのロード
  try {
    model = await new Promise((resolve, reject) => {
      word2vec.loadModel(modelPath, (error, model) => {
        if (error) {
          reject(error);
        } else {
          console.log('モデルを正常にロードしました。');
          resolve(model);
        }
      });
    });
  } catch (error) {
    console.error('モデルのロード中にエラーが発生しました:', error);
    return {
      body: JSON.stringify({ error: 'モデルのロードに失敗しました。' }),
      headers,
      statusCode: 500,
    };
  }

  try {
    if (
      event.hasOwnProperty('queryStringParameters') &&
      event.queryStringParameters.hasOwnProperty('q')
    ) {
      const { q } = event.queryStringParameters;
      const tokens = tokenizer.tokenize(q); // テキストをトークン化（単語に分割）
      const taggedWords = tagger.tag(tokens); // トークン化された単語に品詞タグを付与
      // 名詞（タグが'NN'で始まるもの）を抽出
      const nouns = taggedWords.taggedWords
        .filter((word) => word.tag == 'NN') // タグが'NN'で始まるか確認
        .map((word) => word.token); // 名詞の単語のみを抽出

      if (nouns.length === 0) {
        return {
          body: JSON.stringify({}),
          headers,
          statusCode: 200,
        };
      }

      // 名詞が存在する場合、ランダムに1つ抽出
      const noun = nouns[Math.floor(Math.random() * nouns.length)];
      // 関数を使用して関連語を取得
      const relatedWords = await getRelatedWords(noun);
      const similarityResults = [];

      relatedWords.forEach(async (relatedWord) => {
        const similarity = model.similarity(noun, relatedWord);
        if (similarity !== undefined && similarity !== null) {
          similarityResults.push({ word: relatedWord, similarity });
        }
      });

      if (similarityResults.length === 0) {
        return {
          body: JSON.stringify({}),
          headers,
          statusCode: 200,
        };
      }

      // 類似度が小さい順にソート
      similarityResults.sort((a, b) => a.similarity - b.similarity);

      const { word } = similarityResults[0];

      const response = await axios.get(
        `https://www.googleapis.com/customsearch/v1?${qs.stringify({
          cx,
          key,
          q: word,
        })}`
      );

      if (response.statusText === 'OK') {
        return {
          body: JSON.stringify({
            ...response.data,
          }),
          headers,
          statusCode: 200,
        };
      }
    }

    return {
      body: JSON.stringify({
        message: 'No query string parameters found',
      }),
      headers,
      statusCode: 400,
    };
  } catch (error) {
    return {
      body: JSON.stringify({ error }),
      headers,
      statusCode: 400,
    };
  }
};