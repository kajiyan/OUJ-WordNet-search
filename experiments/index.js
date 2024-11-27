const natural = require('natural');
const word2vec = require('word2vec');

const LANGUAGE = 'EN'; // 言語設定（英語）
const DEFAULT_CATEGORY = 'N'; // デフォルトの品詞カテゴリ（名詞）
const DEFAULT_CATEGORY_CAPITALIZED = 'NNP'; // 大文字で始まる単語のデフォルト品詞カテゴリ（固有名詞）
const MODEL_PATH = 'glove.6B.100d.word2vec.txt';

const wordnet = new natural.WordNet();
const tokenizer = new natural.WordTokenizer(); // 単語トークナイザーの作成
// 品詞タグ付け用の辞書の作成
const lexicon = new natural.Lexicon(LANGUAGE, DEFAULT_CATEGORY, DEFAULT_CATEGORY_CAPITALIZED);
// 品詞タグ付け用のルールセットの作成
const ruleSet = new natural.RuleSet(LANGUAGE);
// Brillの品詞タグ付け器の作成
const tagger = new natural.BrillPOSTagger(lexicon, ruleSet);

const loadWord2VecModel = (modelPath) => {
  return new Promise((resolve, reject) => {
    word2vec.loadModel(modelPath, (error, model) => {
      if (error) {
        reject(error);
      } else {
        resolve(model);
      }
    });
  });
};

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

(async () => {
  const model = await loadWord2VecModel(MODEL_PATH);
  
  // 解析対象のテキスト
  const text = 'The quick brown fox jumps over the lazy dog.';
  const tokens = tokenizer.tokenize(text); // テキストをトークン化（単語に分割）
  const taggedWords = tagger.tag(tokens); // トークン化された単語に品詞タグを付与
  // 名詞（タグが'NN'で始まるもの）を抽出
  const nouns = taggedWords.taggedWords
    .filter((word) => word.tag == 'NN') // タグが'NN'で始まるか確認
    .map((word) => word.token); // 名詞の単語のみを抽出

  console.log('Detected nouns:', nouns); // 抽出された名詞を表示

  if (nouns.length === 0) {
    console.error('名詞が見つかりませんでした。');
    return;
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
      console.log(`"${noun}" と "${relatedWord}" の類似度:`, similarity);
    }
  });

  if (similarityResults.length === 0) {
    console.log('類似度を計算できる関連語がありませんでした。');
    return;
  }

  // 類似度が小さい順にソート
  similarityResults.sort((a, b) => a.similarity - b.similarity);

  const lowestSimilarityWord = similarityResults[0];
  console.log(
    `最も類似度が低いキーワード: "${lowestSimilarityWord.word}", 類似度: ${lowestSimilarityWord.similarity}`
  );
})();
