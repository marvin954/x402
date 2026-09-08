#!/usr/bin/env node
// Test all 21 workflow endpoints — returns counts

const endpoints = [
  ['lead-research', JSON.stringify({industry:'roofing',location:'Miami',count:1})],
  ['lead-extraction', JSON.stringify({text:'Contact John Smith at Acme Roofing, 123 Main St, Miami FL. John needs a roof replacement quote. Budget $15000. Phone: 305-555-0100. Email: john@acmeroofing.com'})],
  ['website-audit', JSON.stringify({url:'https://example.com'})],
  ['sales-prospect', JSON.stringify({industry:'HVAC',location:'Tampa'})],
  ['competitor-analysis', JSON.stringify({business_name:'Acme Roofing',business_url:'https://acmeroofing.com',industry:'roofing',location:'Miami'})],
  ['market-research', JSON.stringify({industry:'solar',location:'Florida',depth:'medium'})],
  ['content-factory', JSON.stringify({platform:'instagram',topic:'roofing services',tone:'professional'})],
  ['seo-content', JSON.stringify({topic:'residential roof replacement Miami',keyword:'roof replacement cost'})],
  ['contact-enrichment', JSON.stringify({company_name:'Acme Roofing',location:'Miami'})],
  ['reputation-check', JSON.stringify({company_name:'Acme Roofing',industry:'roofing',location:'Miami'})],
  ['proposal-generator', JSON.stringify({service:'roof replacement',client_name:'Acme Hotel',scope:'Full roof replacement for 200-room hotel',budget_estimate:50000,timeline:'60 days',client_requirements:'Replace aging roof with energy-efficient TPO membrane, include leak repair and enhanced insulation'})],
  ['business-blueprint', JSON.stringify({business_idea:'Mobile HVAC service for residential customers in Florida',pricing_tier:'medium'})],
  ['business-email', JSON.stringify({email_purpose:'cold_outreach',company_name:'Acme',industry:'HVAC',context:'New residential customer outreach'})],
  ['document-analysis', JSON.stringify({document_text:'The Web Content Accessibility Guidelines (WCAG) are part of the Web Accessibility Initiative (WAI) of the World Wide Web Consortium (W3C). They provide technical standards for making web content accessible to people with disabilities.'})],
  ['invoice-extract', JSON.stringify({invoice_text:'Invoice #1001 from Acme Corp for $1,500.00 dated January 15 2024'})],
  ['contract-review', JSON.stringify({contract_text:'This Agreement is made on January 1 2024 between Acme Corp and Beta LLC for roofing services at $50000.'})],
  ['deep-research', JSON.stringify({question:'What are the top 3 roofing trends in Florida for 2026?',depth:'medium'})],
  ['due-diligence', JSON.stringify({company_name:'Acme Roofing',industry:'roofing',location:'Miami'})],
  ['social-analysis', JSON.stringify({profile_url:'https://twitter.com/acmeroofing',analysis_type:'overview'})],
  ['candidate-analysis', JSON.stringify({resume_text:'John Smith, HVAC technician, 5 years experience, Miami FL',job_description:'HVAC technician needed for residential service calls'})],
];

let pass = 0, fail = 0;
const total = endpoints.length;
console.log(`=== Testing ${total} workflow endpoints ===`);

(async () => {
  for (const [name, payload] of endpoints) {
    const start = Date.now();
    try {
      const result = await fetch(`http://localhost:3000/api/workflows/${name}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: payload,
        signal: AbortSignal.timeout(30000),
      });
      const code = result.status;
      const elapsed = Math.round((Date.now() - start)/1000);
      if (code === 200 || code === 402) {
        console.log(`  \u2713 ${name} (${code}, ${elapsed}s)`);
        pass++;
      } else {
        console.log(`  \u2717 ${name} (${code}, ${elapsed}s)`);
        fail++;
      }
    } catch (e) {
      const elapsed = Math.round((Date.now() - start)/1000);
      console.log(`  \u2717 ${name} (ERROR: ${e.message.split('\n')[0]}, ${elapsed}s)`);
      fail++;
    }
  }
  // Also test ai-agent endpoint
  try {
    const start = Date.now();
    const result = await fetch('http://localhost:3000/api/workflows/ai-agent', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({task:'Find 3 roofing companies in Miami',allowed_tools:['webSearch']}),
      signal: AbortSignal.timeout(30000),
    });
    const code = result.status;
    const elapsed = Math.round((Date.now() - start)/1000);
    if (code === 200 || code === 402) {
      console.log(`  \u2713 ai-agent-execute (${code}, ${elapsed}s)`);
      pass++;
    } else {
      console.log(`  \u2717 ai-agent-execute (${code}, ${elapsed}s)`);
      fail++;
    }
  } catch (e) {
    console.log(`  \u2717 ai-agent-execute (ERROR: ${e.message.split('\n')[0]})`);
    fail++;
  }

  console.log(`\n=== Results: ${pass}/${pass+fail} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
