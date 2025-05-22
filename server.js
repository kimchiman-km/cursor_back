const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs').promises;
const vision = require('@google-cloud/vision');
const OpenAI = require('openai');

// 환경 변수 설정
dotenv.config();
console.log('서버 시작 - 환경 설정:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  HAS_OPENAI_KEY: !!process.env.OPENAI_API_KEY
});

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI 설정
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// CORS 설정
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
};
console.log('CORS 설정:', corsOptions);

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('요청 헤더:', req.headers);
  next();
});

app.use(cors(corsOptions));
app.use(express.json());

// 상태 확인 엔드포인트
app.get('/', (req, res) => {
  console.log('상태 확인 요청 받음');
  res.json({ status: 'ok', message: 'Server is running', timestamp: new Date().toISOString() });
});

// 밈 데이터 파일 경로
const MEMES_FILE_PATH = path.join(__dirname, 'data', 'memes.json');
console.log('밈 데이터 파일 경로:', MEMES_FILE_PATH);

// 데이터 파일 존재 확인 및 생성
const initializeDataFile = async () => {
  try {
    console.log('데이터 파일 초기화 시작');
    await fs.access(MEMES_FILE_PATH);
    console.log('데이터 파일이 이미 존재함');
    const data = await fs.readFile(MEMES_FILE_PATH, 'utf8');
    console.log('현재 데이터:', data);
  } catch (error) {
    console.log('데이터 파일 없음, 새로 생성');
    // 디렉토리 생성
    await fs.mkdir(path.dirname(MEMES_FILE_PATH), { recursive: true });
    
    // 초기 데이터 생성
    const initialData = {
      memes: [
        {
          "id": "meme001",
          "imageUrl": "https://i.imgur.com/hM1LFE5.jpg",
          "title": "화난 고양이",
          "description": "분노의 눈빛을 보내는 고양이 짤방",
          "source": "디시인사이드",
          "tags": ["고양이", "분노", "귀여움"],
          "uploadDate": "2024-03-20T12:00:00Z",
          "ai_labels": ["cat", "animal", "facial_expression"],
          "ai_text_ocr": "",
          "ai_emotion": "분노"
        },
        {
          "id": "meme002",
          "imageUrl": "https://i.imgur.com/sohWhy9.jpg",
          "title": "놀란 피카츄",
          "description": "충격과 공포의 피카츄 표정",
          "source": "에펨코리아",
          "tags": ["피카츄", "포켓몬", "놀람"],
          "uploadDate": "2024-03-20T12:30:00Z",
          "ai_labels": ["pikachu", "pokemon", "surprised_face"],
          "ai_text_ocr": "",
          "ai_emotion": "놀람"
        }
      ]
    };
    await fs.writeFile(MEMES_FILE_PATH, JSON.stringify(initialData, null, 2), 'utf8');
    console.log('초기 데이터 파일 생성 완료');
  }
};

// 서버 시작 시 데이터 파일 초기화
initializeDataFile().catch(error => {
  console.error('데이터 파일 초기화 중 오류:', error);
});

// OpenAI를 사용한 밈 설명 생성
const generateMemeDescription = async (imageUrl, title) => {
  try {
    console.log(`${title} 밈에 대한 설명 생성 중...`);
    const completion = await openai.chat.completions.create({
      model: "gpt-4-vision-preview-1106",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `이 밈/짤방에 대해 재미있고 위트있게 설명해주세요. 제목: ${title}` },
            { type: "image_url", url: imageUrl }
          ],
        },
      ],
      max_tokens: 150,
    });
    
    console.log(`${title} 밈 설명 생성 완료`);
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API 호출 중 오류:', error);
    return null;
  }
};

// 밈 데이터 가져오기 API 수정
app.get('/api/memes', async (req, res) => {
  try {
    console.log('밈 데이터 요청 받음');
    const data = await fs.readFile(MEMES_FILE_PATH, 'utf8');
    const memes = JSON.parse(data);
    
    // 설명이 없는 밈만 처리
    const memesNeedingDescription = memes.memes.filter(meme => !meme.ai_description);
    
    if (memesNeedingDescription.length > 0) {
      console.log(`${memesNeedingDescription.length}개의 밈에 대한 설명 생성 필요`);
      
      // 병렬로 설명 생성
      const descriptions = await Promise.all(
        memesNeedingDescription.map(async meme => {
          const description = await generateMemeDescription(meme.imageUrl, meme.title);
          return { id: meme.id, description };
        })
      );
      
      // 설명 업데이트
      descriptions.forEach(({ id, description }) => {
        if (description) {
          const meme = memes.memes.find(m => m.id === id);
          if (meme) {
            meme.ai_description = description;
          }
        }
      });
      
      // 업데이트된 데이터 저장
      await fs.writeFile(MEMES_FILE_PATH, JSON.stringify(memes, null, 2), 'utf8');
      console.log('밈 설명 업데이트 완료');
    }
    
    res.json(memes);
  } catch (error) {
    console.error('밈 데이터 로딩 중 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 밈 검색 API
app.get('/api/memes/search', async (req, res) => {
  try {
    console.log('검색 요청 받음:', req.query);
    const { q } = req.query;
    if (!q) {
      console.log('검색어 없음');
      return res.status(400).json({ error: '검색어를 입력해주세요.' });
    }

    const data = await fs.readFile(MEMES_FILE_PATH, 'utf8');
    const { memes } = JSON.parse(data);
    
    const searchQuery = q.toLowerCase();
    console.log('검색어 (소문자):', searchQuery);
    
    const searchResults = memes.filter(meme => {
      const searchableFields = [
        meme.title.toLowerCase(),
        meme.description.toLowerCase(),
        ...meme.tags.map(tag => tag.toLowerCase()),
        ...meme.ai_labels.map(label => label.toLowerCase()),
        meme.ai_text_ocr.toLowerCase(),
        meme.ai_emotion.toLowerCase()
      ];
      
      return searchableFields.some(field => field.includes(searchQuery));
    });

    console.log('검색 결과 수:', searchResults.length);
    res.json({ memes: searchResults });
  } catch (error) {
    console.error('검색 중 상세 오류:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Google Cloud Vision API를 사용한 이미지 분석
const analyzeImage = async (imageUrl) => {
  try {
    const client = new vision.ImageAnnotatorClient();
    
    // 이미지 분석 수행
    const [labelDetection] = await client.labelDetection(imageUrl);
    const [textDetection] = await client.textDetection(imageUrl);
    const [faceDetection] = await client.faceDetection(imageUrl);
    
    // 결과 파싱
    const labels = labelDetection.labelAnnotations.map(label => label.description);
    const textOcr = textDetection?.fullTextAnnotation?.text || '';
    const emotion = faceDetection.faceAnnotations?.[0]?.joyLikelihood || '';
    
    return {
      ai_labels: labels,
      ai_text_ocr: textOcr,
      ai_emotion: emotion
    };
  } catch (error) {
    console.error('이미지 분석 중 오류 발생:', error);
    throw error;
  }
};

// 서버 시작
app.listen(PORT, '0.0.0.0', () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log('서버 설정 완료');
}); 