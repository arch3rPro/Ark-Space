# Structured Extract

Use `web.extract` when exact public URLs must produce JSON matching a supplied JSON Schema. Firecrawl is the only Provider for this operation, and extraction consumes model-backed Provider credits.

1. Define a top-level object schema without references or regular-expression keywords. Keep it limited to fields required by the task.
2. Create a protocol request with 1–20 exact, credential-free HTTP(S) URLs:

   ```json
   {
     "protocolVersion": 1,
     "capability": "web.extract",
     "input": {
       "urls": ["https://example.com/pricing"],
       "prompt": "Extract each public plan and monthly price.",
       "schema": {
         "type": "object",
         "properties": {
           "plans": {
             "type": "array",
             "items": {
               "type": "object",
               "properties": {
                 "name": { "type": "string" },
                 "monthlyPrice": { "type": ["number", "null"] }
               },
               "required": ["name", "monthlyPrice"]
             }
           }
         },
         "required": ["plans"]
       }
     }
   }
   ```

3. Run `arks invoke web.extract --input <temporary-json-file>`.
4. Treat successful data as model-extracted claims that still require source verification for consequential use.

ArkSpace validates completed data against the supplied schema. Firecrawl's current Extract API has no documented cancellation endpoint. When polling fails after job creation, ArkSpace marks the operation unsafe to retry and returns the remote Job ID. Report that warning and avoid submitting a duplicate paid job.
