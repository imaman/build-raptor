import { z } from 'zod'

/*
{
  "numFailedTestSuites": 1,
  "numFailedTests": 1,
  "numPassedTestSuites": 15,
  ...
  "startTime": 1642003231059,
  "success": false,
  "testResults": [
    {
      "assertionResults": [
        {
          "ancestorTitles": [
            "misc",
            "computeObjectHash"
          ],
          "failureMessages": [],
          "fullName": "misc computeObjectHash object hash of two identical objects is identical",
          "location": null,
          "status": "passed",
          "title": "object hash of two identical objects is identical"
        },
        {
          "ancestorTitles": [
            "misc",
            "computeObjectHash"
          ],
          "failureMessages": [],
          "fullName": "misc computeObjectHash object hash of two object with different order of keys is the same",
          "location": null,
          "status": "passed",
          "title": "object hash of two object with different order of keys is the same"
        }
      ],
      "endTime": 1642003231453,
      "message": "\u001b[1m\u001b[31m  \u001b[1m● \u001b[22m\u001b[1mmisc › dumpFile › copies the content of a file to the given output stream\u001b[39m\u001b[22m\n\n    \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoEqual\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m) // deep equality\u001b[22m\n\n    Expected: \u001b[32m\"we choose to go to the moon\u001b[7m_\u001b[27m\"\u001b[39m\n    Received: \u001b[31m\"we choose to go to the moon\"\u001b[39m\n\u001b[2m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 33 |\u001b[39m         \u001b[36mawait\u001b[39m dumpFile(src\u001b[33m,\u001b[39m stream)\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 34 |\u001b[39m         \u001b[36mconst\u001b[39m content \u001b[33m=\u001b[39m \u001b[36mawait\u001b[39m fse\u001b[33m.\u001b[39mreadFile(f\u001b[33m,\u001b[39m \u001b[32m'utf-8'\u001b[39m)\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m\u001b[31m\u001b[1m>\u001b[22m\u001b[2m\u001b[39m\u001b[90m 35 |\u001b[39m         expect(content)\u001b[33m.\u001b[39mtoEqual(\u001b[32m'we choose to go to the moon_'\u001b[39m)\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m    |\u001b[39m                         \u001b[31m\u001b[1m^\u001b[22m\u001b[2m\u001b[39m\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 36 |\u001b[39m       } \u001b[36mfinally\u001b[39m {\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 37 |\u001b[39m         stream\u001b[33m.\u001b[39mclose()\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 38 |\u001b[39m       }\u001b[0m\u001b[22m\n\u001b[2m\u001b[22m\n\u001b[2m      \u001b[2mat Object.<anonymous> (\u001b[22m\u001b[2m\u001b[0m\u001b[36mmodules/misc/tests/misc.spec.ts\u001b[39m\u001b[0m\u001b[2m:35:25)\u001b[22m\u001b[2m\u001b[22m\n",
      "name": "/Users/itay_maman/code/imaman/build-raptor/modules/misc/dist/tests/misc.spec.js",
      "startTime": 1642003231237,
      "status": "failed",
      "summary": ""
    }
  ]
*/
export const JestJson = z.object({
  testResults: z
    .object({
      status: z.string(),
      name: z.string(),
      message: z.string(),
      assertionResults: z.object({ fullName: z.string(), status: z.string() }).array(),
    })
    .array(),
})

export type JestJson = z.infer<typeof JestJson>
