use super::mock_server::*;

#[tokio::test]
async fn serves_ranges_and_expires_tokens() {
    let s = MockServer::start(MockOpts { size: 100_000, ranges: true, ..Default::default() }).await;
    let c = reqwest::Client::new();
    let r = c.get(s.url()).header("Range", "bytes=10-19").send().await.unwrap();
    assert_eq!(r.status(), 206);
    assert_eq!(r.headers()["content-range"], "bytes 10-19/100000");
    assert_eq!(r.bytes().await.unwrap().to_vec(), pattern(100_000)[10..20].to_vec());

    let old = s.url();
    let new = s.rotate();
    assert_eq!(c.get(old).send().await.unwrap().status(), 403);
    assert_eq!(c.get(new).send().await.unwrap().status(), 200);
}
