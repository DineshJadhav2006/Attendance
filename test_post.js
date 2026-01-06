(async ()=>{
  try{
    const r = await fetch('http://localhost:3000/api/assistant',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ prompt: 'Hello, who are you?' })
    });
    console.log('STATUS', r.status);
    const txt = await r.text();
    console.log('BODY:\n', txt);
  } catch (e) {
    console.error('ERR', e);
  }
})();
