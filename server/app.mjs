import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '../web');
const indexHtmlPath = path.join(webRoot, 'index.html');

const app = express();
app.use(express.json({ limit: '256kb' }));

async function invoke(req, capability, input){
  const token = req.get('X-Knowi-Capability-Token');
  const resp = await fetch(process.env.KNOWI_GATEWAY_URL + '/v1/capabilities', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Knowi-Capability-Token': token || ''
    },
    body: JSON.stringify({ capability, input })
  });
  if(!resp.ok){
    let message = 'Capability request failed (' + resp.status + ')';
    try{
      const errJson = await resp.json();
      if(errJson && errJson.error) message = errJson.error;
    }catch(e){ /* ignore parse failure */ }
    throw new Error(message);
  }
  return resp.json();
}

async function queryAll(req, binding, fields, pageLimit){
  let rows = [];
  let offset = 0;
  for(;;){
    const result = await invoke(req, 'data.query', { binding, limit: pageLimit, offset, fields });
    rows = rows.concat(result.rows || []);
    if(result.truncated && typeof result.nextOffset === 'number'){
      offset = result.nextOffset;
    } else {
      break;
    }
  }
  return rows;
}

const TERMS_FIELDS = ['term_code', 'term_name', 'is_current'];
const CLASSES_FIELDS = [
  'term_code','class_nbr','subject','subject_name','catalog_nbr','course','section','component',
  'title','instructor','days','sun','mon','tue','wed','thu','fri','sat','start_time','end_time',
  'time_tba','room','units','has_sections','section_count','extra_meetings'
];
const SECTIONS_FIELDS = [
  'term_code','parent_class_nbr','section_nbr','section_code','component','course','title','days',
  'sun','mon','tue','wed','thu','fri','sat','start_time','end_time','time_tba','room','instructor'
];

app.get('/api/schedule', async (req, res) => {
  try{
    const [terms, classes, sections] = await Promise.all([
      queryAll(req, 'terms', TERMS_FIELDS, 500),
      queryAll(req, 'classes', CLASSES_FIELDS, 1000),
      queryAll(req, 'sections', SECTIONS_FIELDS, 1000)
    ]);
    res.json({ terms, classes, sections });
  }catch(err){
    res.status(502).json({ error: err.message || 'Failed to load the schedule of classes.' });
  }
});

app.use(express.static(webRoot));

app.use((req, res, next) => {
  if(req.method !== 'GET' && req.method !== 'HEAD') return next();
  if(req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(indexHtmlPath);
});

const port = Number(process.env.PORT);
app.listen(port, '0.0.0.0');
