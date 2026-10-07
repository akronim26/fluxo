import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import nacl from 'tweetnacl';
import { groth16 } from 'snarkjs';
import { PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import AxeBuilder from '@axe-core/playwright';
import deployment from '../../../deploy/devnet.json' with { type: 'json' };
import idl from '../../../deploy/idl/brizo_pool.json' with { type: 'json' };

const project = resolve(import.meta.dirname,'../../..');
const vectors = JSON.parse(readFileSync(resolve(project,'circuits/build/poseidon-vectors.json'),'utf8'));
const enclave = nacl.box.keyPair();
const names = ['credit.wasm','credit_final.zkey','verification_key.json'];
const config = { ...deployment, enclaveBoxPublicKey: Buffer.from(enclave.publicKey).toString('base64'), ready: { spend:true,faucet:true }, circuit: { wasmUrl:'/circuits/credit.wasm',zkeyUrl:'/circuits/credit_final.zkey',verificationKeyUrl:'/circuits/verification_key.json',sha256:Object.fromEntries(names.map(name=>[name,createHash('sha256').update(readFileSync(resolve(project,'circuits/build',name))).digest('hex')])) } };
const note = {version:1,pool:deployment.pool,secret:'123',nk:'456',commitment:vectors.commitment,nextI:0,leafIndex:0};
async function configure(page: Page, ready=true) { await page.route('**/api/config',r=>r.fulfill({json:{...config,ready:{spend:ready,faucet:ready}}})); }
async function mockLeaves(page: Page, commitment=BigInt(vectors.commitment), deposited=true) {
  await page.route('https://api.devnet.solana.com/',async route=>{
    const request = route.request().postDataJSON();
    const leaves = Buffer.alloc(32784); leaves.set(idl.accounts.find(a=>a.name==='Leaves')!.discriminator); leaves.writeUInt32LE(deposited ? 1 : 0,8); if(deposited) leaves.set(Buffer.from(commitment.toString(16).padStart(64,'0'),'hex'),16);
    await route.fulfill({json:{jsonrpc:'2.0',id:request.id,result:{context:{slot:100},value:{data:[leaves.toString('base64'),'base64'],executable:false,lamports:1,owner:deployment.programId,rentEpoch:0,space:leaves.length}}}});
  });
}

test('reference layout, section interactions, mobile menu and no horizontal overflow', async ({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await expect(page).toHaveTitle(/Brizo/);
  await expect(page.getByRole('heading',{level:1})).toContainText('The freedom');
  await page.getByRole('button',{name:/Ask. Review what you share/}).click(); await expect(page.getByText('personal details → removed')).toBeVisible();
  await page.getByRole('tab',{name:'Answer',exact:true}).click(); await expect(page.getByRole('tabpanel')).toContainText('GET /api/answer/');
  await page.getByText('Is Brizo completely anonymous?',{exact:true}).click(); await expect(page.getByText(/A small pool of depositors weakens/)).toBeVisible();
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:1000}); await page.goto('/');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if(width===390){await page.getByRole('button',{name:'Open menu'}).click();await page.locator('#mobile-menu').getByRole('link',{name:'Features',exact:true}).click();await expect(page.locator('#mobile-menu')).toHaveCount(0);}
    if(width===390||width===1440){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`test-results/landing-${width}.png`});}
  }
  expect(errors).toEqual([]);
});

test('gateway failure stays usable, preview is local, and wallet dialog handles keyboard dismissal', async ({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const posts:string[]=[]; page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  await page.route('**/api/config',r=>r.fulfill({status:503,json:{error:'unavailable'}}));
  await page.goto('/#app'); await expect(page.getByText('Gateway unavailable — you can still try the local privacy preview.')).toBeVisible();
  await page.getByRole('button',{name:'Try a sample'}).click(); await page.getByRole('button',{name:'Preview privacy'}).click();
  await expect(page.getByText('A little less personal.')).toBeVisible(); await expect(page.getByRole('button',{name:'Ask privately',exact:true})).toBeDisabled();
  const outgoing = page.locator('.diff-grid>div').nth(1); await expect(outgoing).not.toContainText('Alex'); await expect(outgoing).not.toContainText('Singapore'); await expect(outgoing).not.toContainText('alex@example.com');
  expect(posts).toEqual([]);
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByText('No Solana wallet detected')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);}
  await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'test-results/workspace-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'Back to home'}).click(); await expect(page.getByRole('heading',{level:1})).toContainText('The freedom');
  await page.getByRole('link',{name:'Launch app',exact:false}).click();await expect(page.getByLabel('Your private question')).toHaveValue(/Alex/);
  expect(errors).toEqual([]);
});

test('real browser proof + encryption sends only approved text and decrypts a sealed answer', async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await configure(page);await mockLeaves(page);
  await page.addInitScript(({note})=>localStorage.setItem(`brizo:notes:v1:${note.pool}`,JSON.stringify([note])),{note});
  for(const name of names)await page.route(`**/circuits/${name}`,r=>r.fulfill({body:readFileSync(resolve(project,'circuits/build',name)),contentType:name.endsWith('.json')?'application/json':'application/octet-stream'}));
  let body:Record<string,any>|undefined, sealedAnswer:Record<string,string>|undefined;
  await page.route('**/api/ask',async route=>{
    body=route.request().postDataJSON();
    const key=JSON.parse(readFileSync(resolve(project,'circuits/build/verification_key.json'),'utf8'));
    expect(await groth16.verify(key,body!.publicSignals,body!.proof)).toBe(true);
    const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const digest=createHash('sha256').update(Buffer.from(body!.requestId,'hex')).update(Buffer.from(body!.ciphertext,'base64')).digest('hex');
    expect((BigInt(`0x${digest}`)%FIELD).toString()).toBe(body!.publicSignals[2]);
    const plaintext=nacl.box.open(Buffer.from(body!.ciphertext,'base64'),Buffer.from(body!.nonce,'base64'),Buffer.from(body!.clientPub,'base64'),enclave.secretKey)!;
    const envelope=JSON.parse(new TextDecoder().decode(plaintext));
    expect(envelope.question).not.toContain('Alex');expect(envelope.question).not.toContain('Meridian');expect(envelope.question).not.toContain('Singapore');expect(envelope.question).toContain('work schedule');
    expect(Object.keys(body!).sort()).toEqual(['ciphertext','clientPub','nonce','proof','publicSignals','requestId']);
    const nonce=createHash('sha256').update(Buffer.from(body!.requestId,'hex')).update(Buffer.from(body!.clientPub,'base64')).update('answer').digest().subarray(0,24);
    const answer=JSON.stringify({ok:true,answer:JSON.stringify({general:'Build a routine around a consistent wake time.',branches:[{when:{field:'age',op:'gte',value:30},advice:'A locally selected suggestion.'}],caveats:'Adjust to your needs.'})});
    sealedAnswer={requestId:body!.requestId,ciphertext:Buffer.from(nacl.box(new TextEncoder().encode(answer),nonce,Buffer.from(body!.clientPub,'base64'),enclave.secretKey)).toString('base64'),nonce:nonce.toString('base64'),spendTx:'3'.repeat(88)};
    await route.fulfill({json:{requestId:body!.requestId,spendTx:'3'.repeat(88)}});
  });
  await page.route('**/api/answer/*',r=>r.fulfill({json:sealedAnswer}));
  await page.goto('/#app');await expect(page.locator('.credit-balance')).toContainText('200');
  await page.getByRole('button',{name:'Try a sample'}).click();await page.getByRole('button',{name:'Preview privacy'}).click();
  await page.getByRole('checkbox',{name:/I have reviewed/}).check();await page.getByRole('button',{name:'Ask privately',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your answer.',exact:true})).toBeVisible({timeout:90_000});
  await expect(page.getByText('Build a routine around a consistent wake time.')).toBeVisible();await expect(page.getByText('A locally selected suggestion.')).toBeVisible();
  await expect(page.locator('.credit-balance')).toContainText('199');expect(body).toBeDefined();expect(errors).toEqual([]);
  await expect(page.getByRole('button',{name:'Ask privately',exact:true})).toBeDisabled();
});

test('editing invalidates approval and a bad proving asset never reserves a credit',async({page})=>{
  await configure(page);await mockLeaves(page);await page.addInitScript(({note})=>localStorage.setItem(`brizo:notes:v1:${note.pool}`,JSON.stringify([note])),{note});
  await page.route('**/circuits/*',r=>r.fulfill({body:'tampered'}));
  let posts=0;await page.route('**/api/ask',r=>{posts++;return r.abort();});
  await page.goto('/#app');await page.getByRole('button',{name:'Try a sample'}).click();await page.getByRole('button',{name:'Preview privacy'}).click();await page.getByRole('checkbox',{name:/I have reviewed/}).check();
  await page.getByLabel('Your private question').fill('A new question');await expect(page.getByRole('checkbox',{name:/I have reviewed/})).toHaveCount(0);
  await page.getByRole('button',{name:'Preview privacy'}).click();await page.getByRole('checkbox',{name:/I have reviewed/}).check();await page.getByRole('button',{name:'Ask privately',exact:true}).click();await expect(page.getByRole('alert')).toContainText('integrity check');await expect(page.locator('.credit-balance')).toContainText('200');expect(posts).toBe(0);
});

test('Wallet Standard connection, faucet, simulated deposit, confirmation and encrypted backup',async({page})=>{
  await configure(page);
  const signer=Keypair.generate(), address=signer.publicKey.toBase58();
  let deposited:bigint|undefined, sent=0, simulated=false, signed=false, signature='';
  await page.exposeFunction('signTestTransaction',(bytes:number[])=>{
    expect(simulated).toBe(true); signed=true;
    const transaction=VersionedTransaction.deserialize(Uint8Array.from(bytes));
    expect(transaction.message.staticAccountKeys[0].toBase58()).toBe(address);
    transaction.sign([signer]);return Array.from(transaction.serialize());
  });
  await page.addInitScript(({address,publicKey})=>{
    const account={address,publicKey:Uint8Array.from(publicKey),chains:['solana:devnet'],features:['solana:signTransaction']};
    const wallet={version:'1.0.0',name:'Test Solana Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',chains:['solana:devnet'],accounts:[],features:{
      'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
      'standard:disconnect':{version:'1.0.0',disconnect:async()=>{}},
      'standard:events':{version:'1.0.0',on:()=>()=>{}},
      'solana:signTransaction':{version:'1.0.0',supportedTransactionVersions:[0],signTransaction:async({transaction}: {transaction:Uint8Array})=>[{signedTransaction:Uint8Array.from(await (window as any).signTestTransaction(Array.from(transaction)))}]},
    }};
    window.addEventListener('wallet-standard:app-ready',(event:any)=>event.detail.register(wallet));
  },{address,publicKey:Array.from(signer.publicKey.toBytes())});
  await page.route('**/api/faucet',async route=>{expect(route.request().postDataJSON()).toEqual({owner:address});await route.fulfill({json:{tokenTx:'3'.repeat(88),solTx:'3'.repeat(88)}});});
  await page.routeWebSocket('wss://api.devnet.solana.com/**',ws=>{ws.onMessage(message=>{const data=JSON.parse(String(message));ws.send(JSON.stringify({jsonrpc:'2.0',id:data.id,result:1}));});});
  await page.route('https://api.devnet.solana.com/',async route=>{
    const request=route.request().postDataJSON();let result:unknown;
    if(request.method==='getAccountInfo'){
      let data:Buffer;
      if(request.params[0]===deployment.pool){
        data=Buffer.alloc(329);data.set(idl.accounts.find(a=>a.name==='Pool')!.discriminator);
        for(const [offset,value]of [[40,deployment.mint],[72,deployment.vault],[168,deployment.tree],[200,deployment.leaves]] as const)data.set(new PublicKey(value).toBytes(),offset);
        data.writeBigUInt64LE(10_000_000n,264);data.writeBigUInt64LE(200n,272);data.writeBigUInt64LE(50_000n,280);
      }else{expect(request.params[0]).toBe(deployment.leaves);data=Buffer.alloc(32784);data.set(idl.accounts.find(a=>a.name==='Leaves')!.discriminator);data.writeUInt32LE(deposited?1:0,8);if(deposited)data.set(Buffer.from(deposited.toString(16).padStart(64,'0'),'hex'),16);}
      result={context:{slot:100},value:{data:[data.toString('base64'),'base64'],executable:false,lamports:1,owner:deployment.programId,rentEpoch:0,space:data.length}};
    }else if(request.method==='getLatestBlockhash')result={context:{slot:100},value:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:999999}};
    else if(request.method==='simulateTransaction'){simulated=true;expect(signed).toBe(false);result={context:{slot:100},value:{err:null,logs:[],unitsConsumed:150000}};}
    else if(request.method==='sendTransaction'){
      expect(signed).toBe(true);sent++;
      const tx=VersionedTransaction.deserialize(Buffer.from(request.params[0],'base64'));
      const instruction=tx.message.compiledInstructions.at(-1)!;
      expect(Array.from(instruction.data.slice(0,8))).toEqual(idl.instructions.find(i=>i.name==='deposit')!.discriminator);
      deposited=BigInt(`0x${Buffer.from(instruction.data.slice(8)).toString('hex')}`);signature=bs58.encode(tx.signatures[0]);result=signature;
    }else if(request.method==='getSignatureStatuses')result={context:{slot:101},value:[{slot:101,confirmations:1,err:null,confirmationStatus:'confirmed'}]};
    else if(request.method==='getBlockHeight')result=101;
    else throw new Error(`Unexpected RPC ${request.method}`);
    await route.fulfill({json:{jsonrpc:'2.0',id:request.id,result}});
  });
  await page.goto('/#app');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Test Solana Wallet'}).click();await expect(page.getByRole('button',{name:'Disconnect'})).toBeVisible();
  await page.getByRole('button',{name:'Get free test tokens'}).click();await expect(page.getByText('20 tUSDC and 0.02 devnet SOL sent to your wallet.')).toBeVisible();
  await page.getByRole('button',{name:'Deposit 10 tUSDC'}).click();await expect(page.locator('.credit-balance')).toContainText('200',{timeout:20_000});expect(sent).toBe(1);
  await expect(page.getByRole('link',{name:'View transaction'})).toHaveAttribute('href',`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  await page.getByRole('button',{name:'Backup / restore'}).click();await page.getByLabel('Backup password').fill('correct horse battery');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export notes'}).click();expect((await download).suggestedFilename()).toBe('brizo-encrypted-credits.json');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('landing and workspace pass automated accessibility checks',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await configure(page,false);await page.goto('/#app');await page.getByRole('button',{name:'Try a sample'}).click();await page.getByRole('button',{name:'Preview privacy'}).click();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
