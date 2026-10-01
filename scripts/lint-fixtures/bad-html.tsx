export function BadHtml() {
  return <div dangerouslySetInnerHTML={{ __html: 'unsafe fixture' }} />;
}
